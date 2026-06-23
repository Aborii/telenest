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
  type OnModuleDestroy,
  type OnModuleInit,
} from '@nestjs/common';
import { Observable, Subject } from 'rxjs';

import type { IGramClient } from './gram-client.interface';
import type {
  GramChatInfo,
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
import { TELEGRAM_GRAM_CLIENT } from './telegram-client.constants';

/**
 * Facade for acting as the logged-in account over MTProto.
 *
 * Implements `OnModuleInit`/`OnModuleDestroy`: on init it subscribes to the
 * client's inbound-message events and fans them out through
 * {@link TelegramUserService.updates$}; on destroy it tears the subscription
 * down and completes the stream.
 */
@Injectable()
export class TelegramUserService implements OnModuleInit, OnModuleDestroy {
  /** Logger scoped to this service. */
  private readonly _logger = new Logger(TelegramUserService.name);

  /** Multicast source backing {@link updates$}. */
  private readonly _messages = new Subject<GramMessage>();

  /** Unsubscribe handle returned by `client.onNewMessage`. */
  private _unsubscribe?: () => void;

  /**
   * Hot, multicast stream of inbound messages received by the logged-in
   * account. Subscribers added later only see messages from that point on.
   */
  public readonly updates$: Observable<GramMessage> =
    this._messages.asObservable();

  /**
   * @param client - The MTProto client abstraction.
   */
  public constructor(
    @Inject(TELEGRAM_GRAM_CLIENT) private readonly client: IGramClient,
  ) {}

  /**
   * Begins fanning the client's new-message events into {@link updates$}.
   *
   * @returns Nothing.
   * @throws Never.
   */
  public onModuleInit(): void {
    this._unsubscribe = this.client.onNewMessage((message) =>
      this._messages.next(message),
    );
    this._logger.log('Subscribed to inbound account messages.');
  }

  /**
   * Stops forwarding events and completes the stream.
   *
   * @returns Nothing.
   * @throws Never.
   */
  public onModuleDestroy(): void {
    this._unsubscribe?.();
    this._unsubscribe = undefined;
    this._messages.complete();
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
    return this.client.sendMessage(peer, params);
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
    return this.client.sendFile(peer, params);
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
