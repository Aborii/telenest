/**
 * @file src/lib/client/telegram-user.service.ts
 *
 * PURPOSE
 * -------
 * High-level operations performed *as the logged-in user account* (not as a
 * bot): read the dialog list, fetch messages, and send messages on your own
 * behalf. All methods return library DTOs and require an authorized session
 * (establish one with {@link TelegramAuthService}).
 *
 * It also exposes {@link TelegramUserService.updates$}: a hot stream of inbound
 * messages received by the account (the same source `@OnUserMessage` handlers
 * subscribe to).
 *
 * USAGE
 * -----
 * ```ts
 * const me = await user.getMe();
 * await user.sendMessage('@durov', 'Hi from my own account!');
 * user.updates$.subscribe((m) => console.log('new message', m.text));
 * ```
 *
 * KEY EXPORTS
 * -----------
 * - TelegramUserService: Injectable user-account operations facade.
 */

import {
  Inject,
  Injectable,
  Logger,
  Optional,
  type OnModuleDestroy,
  type OnModuleInit,
} from '@nestjs/common';
import { Observable, ReplaySubject, Subject } from 'rxjs';

import {
  NOOP_TELEGRAM_METRICS,
  TELEGRAM_COUNTERS,
  type TelegramMetricsRecorder,
} from '../common';
import type { IGramClient } from './gram-client.interface';
import {
  withClientRetry,
  type WithClientRetryOptions,
} from './retry';
import type { TelegramClientRetryDefaults } from './telegram-client.options';
import type {
  GramChatActionEvent,
  GramChatInfo,
  GramDeletedMessages,
  GramDeleteMessagesParams,
  GramDialog,
  GramGetDialogsParams,
  GramGetMessagesParams,
  GramGetParticipantsParams,
  GramMediaInfo,
  GramMediaRange,
  GramMessage,
  GramPeer,
  GramPinMessageParams,
  GramSearchMessagesParams,
  GramSendFileParams,
  GramSendMessageParams,
  GramStreamMediaOptions,
  GramUser,
} from './gram-client.types';
import {
  TELEGRAM_CLIENT_METRICS,
  TELEGRAM_GRAM_CLIENT,
} from './telegram-client.constants';

/**
 * Facade for acting as the logged-in account over MTProto.
 *
 * Implements `OnModuleInit`/`OnModuleDestroy`: on init it subscribes to the
 * client's inbound update events (new / edited / deleted messages and chat
 * actions) and fans each out through its matching stream
 * ({@link TelegramUserService.updates$}, {@link TelegramUserService.editedMessages$},
 * {@link TelegramUserService.deletedMessages$}, {@link TelegramUserService.chatActions$});
 * on destroy it tears the subscriptions down and completes every stream.
 *
 * **Catch-up buffer.** When the account is configured with a `replayBufferSize`
 * greater than zero, each stream is backed by a `ReplaySubject` of that size, so
 * a subscriber added *after* bootstrap still receives up to that many of the
 * most recent events. With no buffer (the default) the streams are hot:
 * late subscribers only see events from their subscription point onward.
 */
@Injectable()
export class TelegramUserService implements OnModuleInit, OnModuleDestroy {
  /** Logger scoped to this service. */
  private readonly _logger = new Logger(TelegramUserService.name);

  /** Multicast source backing {@link updates$}. */
  private readonly _messages: Subject<GramMessage>;

  /** Multicast source backing {@link editedMessages$}. */
  private readonly _edited: Subject<GramMessage>;

  /** Multicast source backing {@link deletedMessages$}. */
  private readonly _deleted: Subject<GramDeletedMessages>;

  /** Multicast source backing {@link chatActions$}. */
  private readonly _chatActions: Subject<GramChatActionEvent>;

  /** Unsubscribe handles for every client event subscription opened on init. */
  private readonly _unsubscribers: Array<() => void> = [];

  /** Metrics sink for this account's counters; no-op recorder when none wired. */
  private readonly _metrics: TelegramMetricsRecorder;

  /**
   * Per-stream catch-up depth (`0` = none). When positive, each stream replays
   * up to this many recent events to a late subscriber.
   */
  private readonly _replayBufferSize: number;

  /** Module-level defaults applied by {@link withRetry} (per-call overridable). */
  private readonly _retryDefaults: TelegramClientRetryDefaults;

  /**
   * Multicast stream of inbound **new** messages received by the account.
   * Hot by default; replays recent messages to late subscribers when the
   * account is configured with a `replayBufferSize`.
   */
  public readonly updates$: Observable<GramMessage>;

  /**
   * Multicast stream of **edited** messages. Each emission is the message in its
   * edited state (its `text` reflects the new content). Honors the same
   * catch-up buffer as {@link updates$}.
   */
  public readonly editedMessages$: Observable<GramMessage>;

  /**
   * Multicast stream of **deletion** events. `peerId` is populated only for
   * channel/supergroup deletions (Telegram omits it elsewhere). Honors the same
   * catch-up buffer as {@link updates$}.
   */
  public readonly deletedMessages$: Observable<GramDeletedMessages>;

  /**
   * Multicast stream of **chat-action** events (typing, recording,
   * online/offline, …). Honors the same catch-up buffer as {@link updates$}.
   */
  public readonly chatActions$: Observable<GramChatActionEvent>;

  /**
   * @param client - The MTProto client abstraction.
   * @param metrics - Optional metrics sink. Provided by the module so the
   *   account's `messagesSent` / `messagesReceived` counters are recorded;
   *   omitted in direct unit construction, where it falls back to a no-op.
   * @param replayBufferSize - Optional catch-up depth: when greater than zero,
   *   each update stream replays up to this many recent events to subscribers
   *   added after bootstrap. Defaults to `0` (hot streams, no replay).
   * @param retryDefaults - Optional module-level `FLOOD_WAIT` retry defaults
   *   applied by {@link withRetry}; per-call options always take precedence.
   */
  public constructor(
    @Inject(TELEGRAM_GRAM_CLIENT) private readonly client: IGramClient,
    @Optional()
    @Inject(TELEGRAM_CLIENT_METRICS)
    metrics?: TelegramMetricsRecorder,
    // ── `@Optional()` so direct-DI construction (the module builds this via a
    //    factory that passes the size explicitly) resolves it to `undefined`
    //    rather than failing to find a `Number` provider; the default applies. ─
    @Optional() replayBufferSize = 0,
    @Optional() retryDefaults?: TelegramClientRetryDefaults,
  ) {
    this._metrics = metrics ?? NOOP_TELEGRAM_METRICS;
    this._retryDefaults = retryDefaults ?? {};
    // ── Clamp to a non-negative integer: a bad value disables replay rather
    //    than corrupting the ReplaySubject's buffer size. ─────────────────────
    this._replayBufferSize =
      Number.isFinite(replayBufferSize) && replayBufferSize > 0
        ? Math.floor(replayBufferSize)
        : 0;

    // ── Subjects are built here (not as field initializers) so they can read
    //    the constructor-assigned buffer size. ────────────────────────────────
    this._messages = this.createSubject<GramMessage>();
    this._edited = this.createSubject<GramMessage>();
    this._deleted = this.createSubject<GramDeletedMessages>();
    this._chatActions = this.createSubject<GramChatActionEvent>();

    this.updates$ = this._messages.asObservable();
    this.editedMessages$ = this._edited.asObservable();
    this.deletedMessages$ = this._deleted.asObservable();
    this.chatActions$ = this._chatActions.asObservable();
  }

  /**
   * Builds a stream source honoring the configured catch-up buffer: a
   * `ReplaySubject` of {@link _replayBufferSize} when positive, else a plain hot
   * `Subject`.
   *
   * @returns A fresh multicast subject for one update stream.
   * @throws Never.
   */
  private createSubject<T>(): Subject<T> {
    return this._replayBufferSize > 0
      ? new ReplaySubject<T>(this._replayBufferSize)
      : new Subject<T>();
  }

  /**
   * Subscribes to every inbound client event and fans each into its stream.
   *
   * @returns Nothing.
   * @throws Never.
   */
  public onModuleInit(): void {
    this._unsubscribers.push(
      this.client.onNewMessage((message) => {
        this._metrics.increment(TELEGRAM_COUNTERS.MESSAGES_RECEIVED);
        this._messages.next(message);
      }),
      this.client.onEditedMessage((message) => this._edited.next(message)),
      this.client.onDeletedMessages((event) => this._deleted.next(event)),
      this.client.onChatAction((event) => this._chatActions.next(event)),
    );
    this._logger.log('Subscribed to inbound account updates.');
  }

  /**
   * Stops forwarding events and completes every stream.
   *
   * @returns Nothing.
   * @throws Never.
   */
  public onModuleDestroy(): void {
    for (const unsubscribe of this._unsubscribers) unsubscribe();
    this._unsubscribers.length = 0;
    this._messages.complete();
    this._edited.complete();
    this._deleted.complete();
    this._chatActions.complete();
  }

  /**
   * Runs a client operation with automatic, opt-in `FLOOD_WAIT` back-off.
   *
   * When Telegram rate-limits the wrapped operation it reports the seconds to
   * wait; this sleeps exactly that long and retries, up to the configured
   * attempt budget (module {@link import('./telegram-client.options').TelegramClientModuleOptions.retry}
   * defaults, overridable per call). Every flood-wait it observes — retried or
   * terminal — increments this account's `FLOOD_WAITS` metric. Errors that are
   * not flood-waits propagate immediately, untouched.
   *
   * Retry is **opt-in**: only operations you wrap participate, so non-idempotent
   * calls are never retried behind your back. Wrap whichever operation you want
   * the back-off applied to.
   *
   * @typeParam T - The resolved result type of `operation`.
   * @param operation - The async client call to run (e.g. a `sendMessage`).
   * @param options - Per-call retry overrides; merged over the module defaults.
   * @returns The resolved value of `operation`.
   * @throws The original error if it is not a flood-wait, or the last flood-wait
   *   once retries are exhausted.
   *
   * @example
   * ```ts
   * await user.withRetry(() => user.sendMessage('@channel', text), { retries: 5 });
   * ```
   */
  public withRetry<T>(
    operation: () => Promise<T>,
    options?: WithClientRetryOptions,
  ): Promise<T> {
    return withClientRetry(operation, {
      retries: this._retryDefaults.retries,
      maxDelayMs: this._retryDefaults.maxDelayMs,
      ...options,
      // ── Always record the flood-wait, then chain any caller-supplied hook. ───
      onFloodWait: (info) => {
        this._metrics.increment(TELEGRAM_COUNTERS.FLOOD_WAITS);
        options?.onFloodWait?.(info);
      },
    });
  }

  /**
   * Returns the logged-in account's own profile.
   *
   * @returns The logged-in account's profile.
   * @throws {import('../common').TelegramClientError} If not authorized.
   */
  public async getMe(): Promise<GramUser> {
    await this.ensureConnected();
    return this.client.getMe();
  }

  /**
   * Lists the account's dialogs (conversations).
   *
   * @param params - Optional limit / archived filter.
   * @returns The dialog list.
   * @throws {import('../common').TelegramClientError} On failure.
   */
  public async getDialogs(
    params?: GramGetDialogsParams,
  ): Promise<GramDialog[]> {
    await this.ensureConnected();
    return this.client.getDialogs(params);
  }

  /**
   * Fetches recent messages from a peer.
   *
   * @param peer - Target peer (`'me'`, @username, or numeric id).
   * @param params - Optional limit / pagination bounds.
   * @returns The messages, newest first.
   * @throws {import('../common').TelegramClientError} On failure.
   */
  public async getMessages(
    peer: GramPeer,
    params?: GramGetMessagesParams,
  ): Promise<GramMessage[]> {
    await this.ensureConnected();
    return this.client.getMessages(peer, params);
  }

  /**
   * Sends a message as the logged-in account.
   *
   * @param peer - Target peer (`'me'`, @username, or numeric id).
   * @param text - Message text, or a full {@link GramSendMessageParams} object.
   * @returns The sent message.
   * @throws {import('../common').TelegramClientError} On failure.
   *
   * @example
   * ```ts
   * await user.sendMessage('me', 'Note to self');
   * await user.sendMessage('@channel', { message: '<b>Hi</b>', parseMode: 'html' });
   * ```
   */
  public async sendMessage(
    peer: GramPeer,
    text: string | GramSendMessageParams,
  ): Promise<GramMessage> {
    await this.ensureConnected();
    const params: GramSendMessageParams =
      typeof text === 'string' ? { message: text } : text;
    const sent = await this.client.sendMessage(peer, params);
    this._metrics.increment(TELEGRAM_COUNTERS.MESSAGES_SENT);
    return sent;
  }

  /**
   * Convenience: sends a message to your own "Saved Messages" chat.
   *
   * @param text - The message text.
   * @returns The sent message.
   * @throws {import('../common').TelegramClientError} On failure.
   */
  public async sendToSelf(text: string): Promise<GramMessage> {
    return this.sendMessage('me', text);
  }

  // ── Media ──────────────────────────────────────────────────────────────────

  /**
   * Sends a file (photo, video, document, …) as the logged-in account.
   *
   * @param peer - Target peer (`'me'`, @username, or numeric id).
   * @param params - The file plus optional caption / presentation options.
   * @returns The sent message.
   * @throws {import('../common').TelegramClientError} On failure.
   *
   * @example
   * ```ts
   * await user.sendFile('me', { file: './report.pdf', caption: 'done' });
   * await user.sendFile('@me', { file: photoBuffer, asPhoto: true });
   * ```
   */
  public async sendFile(
    peer: GramPeer,
    params: GramSendFileParams,
  ): Promise<GramMessage> {
    await this.ensureConnected();
    const sent = await this.client.sendFile(peer, params);
    this._metrics.increment(TELEGRAM_COUNTERS.MESSAGES_SENT);
    return sent;
  }

  /**
   * Downloads the media attached to a message into a {@link Buffer}.
   *
   * @param peer - Peer the message belongs to (`'me'`, @username, or numeric id).
   * @param messageId - Id of the message whose media to download.
   * @returns The media bytes, or `undefined` when the message has no
   *   downloadable media (or no longer exists).
   * @throws {import('../common').TelegramClientError} On failure.
   *
   * @example
   * ```ts
   * const [msg] = await user.getMessages('@channel', { limit: 1 });
   * if (msg?.hasMedia) {
   *   const bytes = await user.downloadMedia(msg.peerId, msg.id);
   * }
   * ```
   */
  public async downloadMedia(
    peer: GramPeer,
    messageId: number,
  ): Promise<Buffer | undefined> {
    await this.ensureConnected();
    return this.client.downloadMedia(peer, messageId);
  }

  /**
   * Downloads a peer's current profile photo into a {@link Buffer}.
   *
   * @param peer - Target peer (`'me'`, @username, or numeric id).
   * @returns The photo bytes, or `undefined` when the peer has no photo.
   * @throws {import('../common').TelegramClientError} On failure.
   */
  public async downloadProfilePhoto(
    peer: GramPeer,
  ): Promise<Buffer | undefined> {
    await this.ensureConnected();
    return this.client.downloadProfilePhoto(peer);
  }

  /**
   * Returns metadata about a message's media (kind, MIME, size, dimensions, …)
   * without downloading the bytes — enough to drive an HTTP `Content-Type` /
   * `Content-Length` / `Accept-Ranges` response.
   *
   * @param peer - Peer the message belongs to (`'me'`, @username, or numeric id).
   * @param messageId - Id of the message whose media to describe.
   * @returns The media descriptor, or `undefined` when the message has no
   *   downloadable media.
   * @throws {import('../common').TelegramClientError} On failure.
   */
  public async getMediaInfo(
    peer: GramPeer,
    messageId: number,
  ): Promise<GramMediaInfo | undefined> {
    await this.ensureConnected();
    return this.client.getMediaInfo(peer, messageId);
  }

  /**
   * Downloads a single contiguous byte range of a message's media — the basis
   * for serving HTTP `206 Partial Content` so a player can seek without
   * fetching the whole file.
   *
   * @param peer - Peer the message belongs to (`'me'`, @username, or numeric id).
   * @param messageId - Id of the message whose media to read.
   * @param range - Zero-based byte `offset` and byte `limit` to return.
   * @returns The requested bytes (shorter than `limit` at end-of-file), or
   *   `undefined` when the message has no downloadable media.
   * @throws {import('../common').TelegramClientError} On failure.
   */
  public async downloadMediaRange(
    peer: GramPeer,
    messageId: number,
    range: GramMediaRange,
  ): Promise<Buffer | undefined> {
    await this.ensureConnected();
    return this.client.downloadMediaRange(peer, messageId, range);
  }

  /**
   * Streams a message's media as a lazy sequence of byte chunks for progressive
   * playback — pipe it to an HTTP response instead of buffering the whole file.
   *
   * @param peer - Peer the message belongs to (`'me'`, @username, or numeric id).
   * @param messageId - Id of the message whose media to stream.
   * @param options - Optional byte `offset` / `limit`.
   * @returns An async iterable of byte chunks.
   * @throws {import('../common').TelegramClientError} If the message has no
   *   downloadable media, or on transport failure.
   *
   * @example
   * ```ts
   * for await (const chunk of await user.streamMedia(peerId, msgId, { offset })) {
   *   res.write(chunk);
   * }
   * ```
   */
  public async streamMedia(
    peer: GramPeer,
    messageId: number,
    options?: GramStreamMediaOptions,
  ): Promise<AsyncIterable<Buffer>> {
    await this.ensureConnected();
    return this.client.streamMedia(peer, messageId, options);
  }

  // ── Chats & channels ───────────────────────────────────────────────────────

  /**
   * Joins a public channel or group.
   *
   * @param peer - The channel/group to join (@username or numeric id).
   * @returns Resolves once joined.
   * @throws {import('../common').TelegramClientError} On failure.
   */
  public async joinChannel(peer: GramPeer): Promise<void> {
    await this.ensureConnected();
    return this.client.joinChannel(peer);
  }

  /**
   * Leaves a channel or group.
   *
   * @param peer - The channel/group to leave (@username or numeric id).
   * @returns Resolves once left.
   * @throws {import('../common').TelegramClientError} On failure.
   */
  public async leaveChannel(peer: GramPeer): Promise<void> {
    await this.ensureConnected();
    return this.client.leaveChannel(peer);
  }

  /**
   * Lists the participants of a group or channel.
   *
   * @param peer - The group/channel (@username or numeric id).
   * @param params - Optional limit / name filter. With no `limit`, **every**
   *   participant is fetched (GramJS' default), which is slow and can trigger
   *   `FLOOD_WAIT` on large peers — pass a `limit` unless you need the full roster.
   * @returns The matching participants as user DTOs.
   * @throws {import('../common').TelegramClientError} On failure.
   */
  public async getParticipants(
    peer: GramPeer,
    params?: GramGetParticipantsParams,
  ): Promise<GramUser[]> {
    await this.ensureConnected();
    return this.client.getParticipants(peer, params);
  }

  /**
   * Searches a peer's history for messages matching a text query.
   *
   * @param peer - Target peer (`'me'`, @username, or numeric id).
   * @param query - The text to search for.
   * @param params - Optional limit.
   * @returns The matching messages, newest first.
   * @throws {import('../common').TelegramClientError} On failure.
   */
  public async searchMessages(
    peer: GramPeer,
    query: string,
    params?: GramSearchMessagesParams,
  ): Promise<GramMessage[]> {
    await this.ensureConnected();
    return this.client.searchMessages(peer, query, params);
  }

  /**
   * Fetches extended ("full") information about a chat, channel, or user.
   *
   * @param peer - Target peer (`'me'`, @username, or numeric id).
   * @returns The chat/channel/user info DTO.
   * @throws {import('../common').TelegramClientError} On failure.
   */
  public async getFullChat(peer: GramPeer): Promise<GramChatInfo> {
    await this.ensureConnected();
    return this.client.getFullChat(peer);
  }

  // ── Message operations ─────────────────────────────────────────────────────

  /**
   * Edits the text of a message previously sent in a chat.
   *
   * @param peer - Peer the message belongs to (`'me'`, @username, or numeric id).
   * @param messageId - Id of the message to edit.
   * @param text - The new message text.
   * @returns The edited message.
   * @throws {import('../common').TelegramClientError} On failure.
   */
  public async editMessage(
    peer: GramPeer,
    messageId: number,
    text: string,
  ): Promise<GramMessage> {
    await this.ensureConnected();
    return this.client.editMessage(peer, messageId, text);
  }

  /**
   * Deletes one or more messages from a chat.
   *
   * @param peer - Peer the messages belong to (`'me'`, @username, or numeric id).
   * @param messageIds - Ids of the messages to delete.
   * @param params - Optional `revoke` flag (delete for everyone; default `true`).
   * @returns Resolves once deleted.
   * @throws {import('../common').TelegramClientError} On failure.
   */
  public async deleteMessages(
    peer: GramPeer,
    messageIds: number[],
    params?: GramDeleteMessagesParams,
  ): Promise<void> {
    await this.ensureConnected();
    return this.client.deleteMessages(peer, messageIds, params);
  }

  /**
   * Forwards messages from one peer to another.
   *
   * @param toPeer - Destination peer.
   * @param fromPeer - Source peer the messages currently live in.
   * @param messageIds - Ids of the messages to forward.
   * @returns The forwarded messages as they now exist in `toPeer`.
   * @throws {import('../common').TelegramClientError} On failure.
   */
  public async forwardMessages(
    toPeer: GramPeer,
    fromPeer: GramPeer,
    messageIds: number[],
  ): Promise<GramMessage[]> {
    await this.ensureConnected();
    return this.client.forwardMessages(toPeer, fromPeer, messageIds);
  }

  /**
   * Marks a peer's history as read (clears the unread badge).
   *
   * @param peer - Target peer (`'me'`, @username, or numeric id).
   * @returns Resolves once acknowledged.
   * @throws {import('../common').TelegramClientError} On failure.
   */
  public async markAsRead(peer: GramPeer): Promise<void> {
    await this.ensureConnected();
    return this.client.markAsRead(peer);
  }

  /**
   * Pins a message in a chat.
   *
   * @param peer - Peer the message belongs to (`'me'`, @username, or numeric id).
   * @param messageId - Id of the message to pin.
   * @param params - Optional `notify` flag.
   * @returns Resolves once pinned.
   * @throws {import('../common').TelegramClientError} On failure.
   */
  public async pinMessage(
    peer: GramPeer,
    messageId: number,
    params?: GramPinMessageParams,
  ): Promise<void> {
    await this.ensureConnected();
    return this.client.pinMessage(peer, messageId, params);
  }

  /**
   * Ensures the underlying client is connected before an operation.
   *
   * @returns Resolves once a connection is open.
   * @throws {import('../common').TelegramClientError} If connecting fails.
   */
  private async ensureConnected(): Promise<void> {
    if (!this.client.isConnected()) await this.client.connect();
  }
}
