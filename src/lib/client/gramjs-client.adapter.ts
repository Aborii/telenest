/**
 * @file src/lib/client/gramjs-client.adapter.ts
 *
 * PURPOSE
 * -------
 * The single concrete {@link IGramClient} backed by GramJS (`telegram`). This
 * is the ONLY file in the library that imports GramJS or constructs `Api.*`
 * requests. It translates the low-level MTProto surface into the library's
 * stable DTOs and error types, so every other unit can be tested with a fake.
 *
 * USAGE
 * -----
 * Constructed indirectly by {@link createGramJsClient}, which the module's
 * factory provider calls. Not intended to be instantiated by consumers.
 *
 * KEY EXPORTS
 * -----------
 * - GramJsClientAdapter: IGramClient implementation over a GramJS client.
 * - createGramJsClient: Builds a connected-capable adapter from options.
 */

import { Api, errors, password, sessions, TelegramClient } from 'telegram';
import { NewMessage, type NewMessageEvent } from 'telegram/events';
import type { Dialog } from 'telegram/tl/custom/dialog';

import {
  TelegramAuthError,
  TelegramClientError,
  type TelegramAuthErrorCode,
} from '../common';
import type { IGramClient } from './gram-client.interface';
import {
  GRAM_DIALOG_TYPES,
  GRAM_SIGN_IN_STATUSES,
  type GramChatInfo,
  type GramDeleteMessagesParams,
  type GramDialog,
  type GramDialogType,
  type GramGetDialogsParams,
  type GramGetMessagesParams,
  type GramGetParticipantsParams,
  type GramMessage,
  type GramPeer,
  type GramPinMessageParams,
  type GramSearchMessagesParams,
  type GramSendCodeResult,
  type GramSendFileParams,
  type GramSendMessageParams,
  type GramSignInResult,
  type GramSignInWithCodeInput,
  type GramUser,
} from './gram-client.types';
import type { TelegramClientModuleOptions } from './telegram-client.options';

/** Application credentials needed by GramJS' `sendCode`. */
interface ApiCredentials {
  /** Application api_id. */
  apiId: number;
  /** Application api_hash. */
  apiHash: string;
}

/**
 * Adapts a GramJS {@link TelegramClient} to the library's {@link IGramClient}.
 *
 * Lifecycle: call {@link GramJsClientAdapter.connect} before any authenticated
 * operation. Connection state is tracked locally so `connect`/`disconnect` are
 * idempotent.
 */
export class GramJsClientAdapter implements IGramClient {
  /** Local mirror of the connection state, kept idempotent. */
  private _connected = false;

  /**
   * @param client - The underlying GramJS client.
   * @param stringSession - The session instance, used to export the session
   *   string (the abstract `Session.save()` type erases the string return).
   * @param credentials - api_id / api_hash forwarded to `sendCode`.
   */
  public constructor(
    private readonly client: TelegramClient,
    private readonly stringSession: sessions.StringSession,
    private readonly credentials: ApiCredentials,
  ) {}

  /** {@inheritDoc IGramClient.connect} */
  public async connect(): Promise<void> {
    if (this._connected) return;
    try {
      await this.client.connect();
      this._connected = true;
    } catch (error) {
      throw new TelegramClientError('Failed to connect to Telegram.', {
        operation: 'connect',
        cause: error,
      });
    }
  }

  /** {@inheritDoc IGramClient.disconnect} */
  public async disconnect(): Promise<void> {
    try {
      await this.client.disconnect();
    } catch {
      // ── Disconnect failures are non-actionable; never let them propagate. ──
    } finally {
      this._connected = false;
    }
  }

  /** {@inheritDoc IGramClient.isConnected} */
  public isConnected(): boolean {
    return this._connected;
  }

  /** {@inheritDoc IGramClient.isAuthorized} */
  public async isAuthorized(): Promise<boolean> {
    try {
      return await this.client.checkAuthorization();
    } catch (error) {
      throw new TelegramClientError('Failed to check authorization state.', {
        operation: 'isAuthorized',
        cause: error,
      });
    }
  }

  /** {@inheritDoc IGramClient.sendCode} */
  public async sendCode(
    phoneNumber: string,
    forceSMS = false,
  ): Promise<GramSendCodeResult> {
    try {
      const result = await this.client.sendCode(
        this.credentials,
        phoneNumber,
        forceSMS,
      );
      return {
        phoneCodeHash: result.phoneCodeHash,
        isCodeViaApp: result.isCodeViaApp,
      };
    } catch (error) {
      throw this.toAuthError(error);
    }
  }

  /** {@inheritDoc IGramClient.signInWithCode} */
  public async signInWithCode(
    input: GramSignInWithCodeInput,
  ): Promise<GramSignInResult> {
    try {
      const result = await this.client.invoke(
        new Api.auth.SignIn({
          phoneNumber: input.phoneNumber,
          phoneCodeHash: input.phoneCodeHash,
          phoneCode: input.phoneCode,
        }),
      );

      // ── A brand-new number with no account must complete sign-up first. ────
      if (result instanceof Api.auth.AuthorizationSignUpRequired)
        throw new TelegramAuthError(
          'SIGN_UP_REQUIRED',
          'This phone number is not registered with Telegram.',
        );

      return {
        status: GRAM_SIGN_IN_STATUSES.AUTHORIZED,
        user: this.mapUser(result.user),
      };
    } catch (error) {
      // ── The accounts with 2FA enabled surface a recoverable signal here. ───
      if (this.isPasswordRequired(error))
        return { status: GRAM_SIGN_IN_STATUSES.PASSWORD_REQUIRED };
      throw this.toAuthError(error);
    }
  }

  /** {@inheritDoc IGramClient.signInWithPassword} */
  public async signInWithPassword(passwordValue: string): Promise<GramUser> {
    try {
      const passwordInfo = await this.client.invoke(
        new Api.account.GetPassword(),
      );
      const check = await password.computeCheck(passwordInfo, passwordValue);
      const result = await this.client.invoke(
        new Api.auth.CheckPassword({ password: check }),
      );

      if (result instanceof Api.auth.AuthorizationSignUpRequired)
        throw new TelegramAuthError(
          'SIGN_UP_REQUIRED',
          'This phone number is not registered with Telegram.',
        );

      return this.mapUser(result.user);
    } catch (error) {
      throw this.toAuthError(error);
    }
  }

  /** {@inheritDoc IGramClient.logOut} */
  public async logOut(): Promise<void> {
    try {
      await this.client.invoke(new Api.auth.LogOut());
    } catch (error) {
      throw new TelegramClientError('Failed to log out.', {
        operation: 'logOut',
        cause: error,
      });
    }
  }

  /** {@inheritDoc IGramClient.getMe} */
  public async getMe(): Promise<GramUser> {
    try {
      const me = await this.client.getMe();
      return this.mapUser(me);
    } catch (error) {
      throw new TelegramClientError('Failed to fetch own account info.', {
        operation: 'getMe',
        cause: error,
      });
    }
  }

  /** {@inheritDoc IGramClient.getDialogs} */
  public async getDialogs(
    params: GramGetDialogsParams = {},
  ): Promise<GramDialog[]> {
    try {
      const dialogs = await this.client.getDialogs({
        limit: params.limit,
        archived: params.archived ?? false,
      });
      return dialogs.map((dialog) => this.mapDialog(dialog));
    } catch (error) {
      throw new TelegramClientError('Failed to list dialogs.', {
        operation: 'getDialogs',
        cause: error,
      });
    }
  }

  /** {@inheritDoc IGramClient.getMessages} */
  public async getMessages(
    peer: GramPeer,
    params: GramGetMessagesParams = {},
  ): Promise<GramMessage[]> {
    try {
      const messages = await this.client.getMessages(peer, {
        limit: params.limit,
        minId: params.minId,
        maxId: params.maxId,
      });
      return messages.map((message) => this.mapMessage(message));
    } catch (error) {
      throw new TelegramClientError('Failed to fetch messages.', {
        operation: 'getMessages',
        cause: error,
      });
    }
  }

  /** {@inheritDoc IGramClient.sendMessage} */
  public async sendMessage(
    peer: GramPeer,
    params: GramSendMessageParams,
  ): Promise<GramMessage> {
    try {
      const message = await this.client.sendMessage(peer, {
        message: params.message,
        parseMode: params.parseMode,
        replyTo: params.replyTo,
        silent: params.silent,
      });
      return this.mapMessage(message);
    } catch (error) {
      throw new TelegramClientError('Failed to send message.', {
        operation: 'sendMessage',
        cause: error,
      });
    }
  }

  // ── Media ──────────────────────────────────────────────────────────────────

  /** {@inheritDoc IGramClient.sendFile} */
  public async sendFile(
    peer: GramPeer,
    params: GramSendFileParams,
  ): Promise<GramMessage> {
    try {
      const message = await this.client.sendFile(peer, {
        file: params.file,
        caption: params.caption,
        // ── `asPhoto` inverts GramJS' `forceDocument`; leaving it undefined
        //    keeps GramJS' extension-based inference. ──────────────────────────
        forceDocument:
          params.asPhoto === undefined ? undefined : !params.asPhoto,
        parseMode: params.parseMode,
        replyTo: params.replyTo,
        silent: params.silent,
      });
      return this.mapMessage(message);
    } catch (error) {
      throw new TelegramClientError('Failed to send file.', {
        operation: 'sendFile',
        cause: error,
      });
    }
  }

  /** {@inheritDoc IGramClient.downloadMedia} */
  public async downloadMedia(
    peer: GramPeer,
    messageId: number,
  ): Promise<Buffer | undefined> {
    try {
      const [message] = await this.client.getMessages(peer, {
        ids: [messageId],
      });
      if (!message || !this.hasDownloadableMedia(message)) return undefined;
      const data = await this.client.downloadMedia(message);
      // ── Without an `outputFile`, GramJS resolves to the raw bytes; a string
      //    would only appear if a file path were requested. ───────────────────
      return Buffer.isBuffer(data) ? data : undefined;
    } catch (error) {
      throw new TelegramClientError('Failed to download media.', {
        operation: 'downloadMedia',
        cause: error,
      });
    }
  }

  /** {@inheritDoc IGramClient.downloadProfilePhoto} */
  public async downloadProfilePhoto(
    peer: GramPeer,
  ): Promise<Buffer | undefined> {
    try {
      const data = await this.client.downloadProfilePhoto(peer);
      return Buffer.isBuffer(data) ? data : undefined;
    } catch (error) {
      throw new TelegramClientError('Failed to download profile photo.', {
        operation: 'downloadProfilePhoto',
        cause: error,
      });
    }
  }

  // ── Chats & channels ───────────────────────────────────────────────────────

  /** {@inheritDoc IGramClient.joinChannel} */
  public async joinChannel(peer: GramPeer): Promise<void> {
    try {
      await this.client.invoke(new Api.channels.JoinChannel({ channel: peer }));
    } catch (error) {
      throw new TelegramClientError('Failed to join channel.', {
        operation: 'joinChannel',
        cause: error,
      });
    }
  }

  /** {@inheritDoc IGramClient.leaveChannel} */
  public async leaveChannel(peer: GramPeer): Promise<void> {
    try {
      await this.client.invoke(
        new Api.channels.LeaveChannel({ channel: peer }),
      );
    } catch (error) {
      throw new TelegramClientError('Failed to leave channel.', {
        operation: 'leaveChannel',
        cause: error,
      });
    }
  }

  /** {@inheritDoc IGramClient.getParticipants} */
  public async getParticipants(
    peer: GramPeer,
    params: GramGetParticipantsParams = {},
  ): Promise<GramUser[]> {
    try {
      const participants = await this.client.getParticipants(peer, {
        limit: params.limit,
        search: params.search,
      });
      return participants.map((user) => this.mapUser(user));
    } catch (error) {
      throw new TelegramClientError('Failed to list participants.', {
        operation: 'getParticipants',
        cause: error,
      });
    }
  }

  /** {@inheritDoc IGramClient.searchMessages} */
  public async searchMessages(
    peer: GramPeer,
    query: string,
    params: GramSearchMessagesParams = {},
  ): Promise<GramMessage[]> {
    try {
      const messages = await this.client.getMessages(peer, {
        search: query,
        limit: params.limit,
      });
      return messages.map((message) => this.mapMessage(message));
    } catch (error) {
      throw new TelegramClientError('Failed to search messages.', {
        operation: 'searchMessages',
        cause: error,
      });
    }
  }

  /** {@inheritDoc IGramClient.getFullChat} */
  public async getFullChat(peer: GramPeer): Promise<GramChatInfo> {
    try {
      const entity = await this.client.getEntity(peer);

      // ── User: bio lives on `users.GetFullUser().fullUser.about`. ───────────
      if (entity instanceof Api.User) {
        const full = await this.client.invoke(
          new Api.users.GetFullUser({ id: entity }),
        );
        return this.mapChatInfo(entity, full.fullUser.about, undefined);
      }

      // ── Channel / supergroup: description + count on `ChannelFull`. ─────────
      if (entity instanceof Api.Channel) {
        const full = await this.client.invoke(
          new Api.channels.GetFullChannel({ channel: entity }),
        );
        const fullChat = full.fullChat;
        const count =
          fullChat instanceof Api.ChannelFull
            ? fullChat.participantsCount
            : undefined;
        return this.mapChatInfo(entity, fullChat.about, count);
      }

      // ── Basic group: description on `ChatFull`; count on the entity. ────────
      if (entity instanceof Api.Chat) {
        const full = await this.client.invoke(
          new Api.messages.GetFullChat({ chatId: entity.id }),
        );
        return this.mapChatInfo(
          entity,
          full.fullChat.about,
          entity.participantsCount,
        );
      }

      // ── Empty / forbidden peers carry no full info to surface. ─────────────
      throw new TelegramClientError(
        'Peer has no accessible chat information.',
        { operation: 'getFullChat' },
      );
    } catch (error) {
      throw this.toClientError(error, 'Failed to fetch chat info.', 'getFullChat');
    }
  }

  // ── Message operations ─────────────────────────────────────────────────────

  /** {@inheritDoc IGramClient.editMessage} */
  public async editMessage(
    peer: GramPeer,
    messageId: number,
    text: string,
  ): Promise<GramMessage> {
    try {
      const message = await this.client.editMessage(peer, {
        message: messageId,
        text,
      });
      return this.mapMessage(message);
    } catch (error) {
      throw new TelegramClientError('Failed to edit message.', {
        operation: 'editMessage',
        cause: error,
      });
    }
  }

  /** {@inheritDoc IGramClient.deleteMessages} */
  public async deleteMessages(
    peer: GramPeer,
    messageIds: number[],
    params: GramDeleteMessagesParams = {},
  ): Promise<void> {
    try {
      await this.client.deleteMessages(peer, messageIds, {
        revoke: params.revoke ?? true,
      });
    } catch (error) {
      throw new TelegramClientError('Failed to delete messages.', {
        operation: 'deleteMessages',
        cause: error,
      });
    }
  }

  /** {@inheritDoc IGramClient.forwardMessages} */
  public async forwardMessages(
    toPeer: GramPeer,
    fromPeer: GramPeer,
    messageIds: number[],
  ): Promise<GramMessage[]> {
    try {
      const messages = await this.client.forwardMessages(toPeer, {
        messages: messageIds,
        fromPeer,
      });
      return messages.map((message) => this.mapMessage(message));
    } catch (error) {
      throw new TelegramClientError('Failed to forward messages.', {
        operation: 'forwardMessages',
        cause: error,
      });
    }
  }

  /** {@inheritDoc IGramClient.markAsRead} */
  public async markAsRead(peer: GramPeer): Promise<void> {
    try {
      await this.client.markAsRead(peer);
    } catch (error) {
      throw new TelegramClientError('Failed to mark as read.', {
        operation: 'markAsRead',
        cause: error,
      });
    }
  }

  /** {@inheritDoc IGramClient.pinMessage} */
  public async pinMessage(
    peer: GramPeer,
    messageId: number,
    params: GramPinMessageParams = {},
  ): Promise<void> {
    try {
      await this.client.pinMessage(peer, messageId, {
        notify: params.notify ?? false,
      });
    } catch (error) {
      throw new TelegramClientError('Failed to pin message.', {
        operation: 'pinMessage',
        cause: error,
      });
    }
  }

  /** {@inheritDoc IGramClient.exportSession} */
  public exportSession(): string {
    // ── StringSession.save() returns the encoded string; the abstract base
    //    type widens it to `void`, hence the dedicated reference. ────────────
    return this.stringSession.save() ?? '';
  }

  /** {@inheritDoc IGramClient.onNewMessage} */
  public onNewMessage(handler: (message: GramMessage) => void): () => void {
    const builder = new NewMessage({});
    const callback = (event: NewMessageEvent): void => {
      handler(this.mapMessage(event.message));
    };
    this.client.addEventHandler(callback, builder);
    return () => {
      this.client.removeEventHandler(callback, builder);
    };
  }

  // ── Mapping helpers (Api.* → library DTOs) ─────────────────────────────────

  /**
   * Maps a GramJS user object into a {@link GramUser}.
   *
   * @param user - The `Api.User` / `Api.UserEmpty` to map.
   * @returns The normalized user DTO.
   * @throws Never.
   */
  private mapUser(user: Api.TypeUser): GramUser {
    if (user instanceof Api.UserEmpty)
      return {
        id: user.id.toString(),
        isSelf: false,
        isBot: false,
        isPremium: false,
      };

    return {
      id: user.id.toString(),
      isSelf: Boolean(user.self),
      isBot: Boolean(user.bot),
      isPremium: Boolean(user.premium),
      firstName: user.firstName,
      lastName: user.lastName,
      username: user.username,
      phone: user.phone,
    };
  }

  /**
   * Maps a GramJS {@link Dialog} into a {@link GramDialog}.
   *
   * @param dialog - The GramJS dialog to map.
   * @returns The normalized dialog DTO.
   * @throws Never.
   */
  private mapDialog(dialog: Dialog): GramDialog {
    const type = dialog.isChannel
      ? GRAM_DIALOG_TYPES.CHANNEL
      : dialog.isGroup
        ? GRAM_DIALOG_TYPES.GROUP
        : GRAM_DIALOG_TYPES.USER;

    return {
      id: dialog.id ? dialog.id.toString() : '',
      title: dialog.title ?? dialog.name ?? '',
      type,
      unreadCount: dialog.unreadCount,
      pinned: dialog.pinned,
    };
  }

  /**
   * Maps a GramJS message into a {@link GramMessage}.
   *
   * @param message - The `Api.Message` to map.
   * @returns The normalized message DTO.
   * @throws Never.
   */
  private mapMessage(message: Api.Message): GramMessage {
    const sender = message.senderId;
    return {
      id: message.id,
      peerId: this.peerToString(message.peerId),
      text: message.message ?? '',
      date: message.date,
      out: Boolean(message.out),
      senderId: sender ? sender.toString() : undefined,
      hasMedia: this.hasDownloadableMedia(message),
    };
  }

  /**
   * Reports whether a message carries downloadable media. An empty media
   * placeholder ({@link Api.MessageMediaEmpty}) does not count.
   *
   * @param message - The message to inspect.
   * @returns `true` when the message has non-empty media.
   * @throws Never.
   */
  private hasDownloadableMedia(message: Api.Message): boolean {
    return (
      Boolean(message.media) &&
      !(message.media instanceof Api.MessageMediaEmpty)
    );
  }

  /**
   * Maps a GramJS resolved entity into a {@link GramChatInfo}, merging in the
   * description / participant count read from a matching "full" request.
   *
   * @param entity - The resolved `Api.User` / `Api.Chat` / `Api.Channel`.
   * @param about - The bio/description from the full request, when present.
   * @param participantsCount - Member count from the full request, when present.
   * @returns The normalized chat-info DTO.
   * @throws Never.
   */
  private mapChatInfo(
    entity: Api.User | Api.Chat | Api.Channel,
    about: string | undefined,
    participantsCount: number | undefined,
  ): GramChatInfo {
    if (entity instanceof Api.User) {
      const fullName = [entity.firstName, entity.lastName]
        .filter((part): part is string => Boolean(part))
        .join(' ');
      return {
        id: entity.id.toString(),
        type: GRAM_DIALOG_TYPES.USER,
        title: fullName,
        username: entity.username,
        about,
        participantsCount: undefined,
        verified: Boolean(entity.verified),
      };
    }

    // ── A basic group (`Api.Chat`) is always a group; a `Api.Channel` is a
    //    channel unless its `megagroup` flag marks it as a supergroup. ────────
    const type: GramDialogType =
      entity instanceof Api.Chat
        ? GRAM_DIALOG_TYPES.GROUP
        : entity.megagroup
          ? GRAM_DIALOG_TYPES.GROUP
          : GRAM_DIALOG_TYPES.CHANNEL;

    return {
      id: entity.id.toString(),
      type,
      title: entity.title,
      // ── Basic groups have no username; only channels/supergroups do. ───────
      username: entity instanceof Api.Channel ? entity.username : undefined,
      about,
      participantsCount,
      verified:
        entity instanceof Api.Channel ? Boolean(entity.verified) : false,
    };
  }

  /**
   * Reduces an `Api.TypePeer` to its numeric id as a string.
   *
   * @param peer - The peer to reduce, if present.
   * @returns The peer id as a decimal string, or `''` when unresolvable.
   * @throws Never.
   */
  private peerToString(peer: Api.TypePeer | undefined): string {
    if (peer instanceof Api.PeerUser) return peer.userId.toString();
    if (peer instanceof Api.PeerChat) return peer.chatId.toString();
    if (peer instanceof Api.PeerChannel) return peer.channelId.toString();
    return '';
  }

  // ── Error mapping ──────────────────────────────────────────────────────────

  /**
   * Wraps a caught value in a {@link TelegramClientError}, passing an existing
   * {@link TelegramClientError} through unchanged. Lets a method `throw` a
   * precise client error from inside its own `try` block without it being
   * double-wrapped by the surrounding `catch`.
   *
   * @param error - The caught value.
   * @param message - Message for the wrapper when `error` is not already one.
   * @param operation - The operation name recorded on the wrapper.
   * @returns A {@link TelegramClientError}.
   * @throws Never.
   */
  private toClientError(
    error: unknown,
    message: string,
    operation: string,
  ): TelegramClientError {
    if (error instanceof TelegramClientError) return error;
    return new TelegramClientError(message, { operation, cause: error });
  }

  /**
   * Detects GramJS' `SESSION_PASSWORD_NEEDED` signal (2FA required).
   *
   * @param error - The caught value.
   * @returns `true` when 2FA is required to continue.
   * @throws Never.
   */
  private isPasswordRequired(error: unknown): boolean {
    return this.readErrorMessage(error) === 'SESSION_PASSWORD_NEEDED';
  }

  /**
   * Extracts a stable message string from a GramJS / generic error.
   *
   * @param error - The caught value.
   * @returns GramJS' `errorMessage` when available, else the error message.
   * @throws Never.
   */
  private readErrorMessage(error: unknown): string {
    if (error instanceof errors.RPCError) return error.errorMessage;
    if (error instanceof Error) return error.message;
    return String(error);
  }

  /**
   * Maps a GramJS auth failure into a typed {@link TelegramAuthError}.
   *
   * @param error - The caught value.
   * @returns A {@link TelegramAuthError} with a precise code.
   * @throws Never.
   */
  private toAuthError(error: unknown): TelegramAuthError {
    if (error instanceof TelegramAuthError) return error;

    // ── GramJS' FloodWaitError carries the delay on `.seconds`, and its
    //    `errorMessage` is the bare string "FLOOD" (not "FLOOD_WAIT_N"), so it
    //    must be detected by type rather than by message text. ───────────────
    if (error instanceof errors.FloodWaitError)
      return new TelegramAuthError(
        'FLOOD_WAIT',
        `Telegram flood wait: ${error.seconds}s required`,
        { retryAfterSeconds: error.seconds, cause: error },
      );

    const message = this.readErrorMessage(error);
    let code: TelegramAuthErrorCode = 'UNKNOWN';
    let retryAfterSeconds: number | undefined;

    if (message === 'PHONE_NUMBER_INVALID') code = 'PHONE_INVALID';
    else if (message.startsWith('PHONE_CODE')) code = 'CODE_INVALID';
    else if (message === 'PASSWORD_HASH_INVALID') code = 'PASSWORD_INVALID';
    else if (message === 'SESSION_PASSWORD_NEEDED') code = 'PASSWORD_REQUIRED';
    else if (message.startsWith('FLOOD_WAIT')) {
      // ── Fallback for a non-typed error whose message embeds FLOOD_WAIT_N. ──
      code = 'FLOOD_WAIT';
      retryAfterSeconds = this.readFloodSeconds(error, message);
    }

    return new TelegramAuthError(code, `Telegram sign-in failed: ${message}`, {
      retryAfterSeconds,
      cause: error,
    });
  }

  /**
   * Reads the flood-wait delay from a GramJS `FloodWaitError` or its message.
   *
   * @param error - The caught value (may carry a `seconds` field).
   * @param message - The already-extracted error message.
   * @returns The wait in seconds, or `undefined` if it cannot be determined.
   * @throws Never.
   */
  private readFloodSeconds(
    error: unknown,
    message: string,
  ): number | undefined {
    const direct = (error as { seconds?: unknown }).seconds;
    if (typeof direct === 'number') return direct;
    const match = /FLOOD_WAIT_(\d+)/.exec(message);
    return match ? Number(match[1]) : undefined;
  }
}

/**
 * Builds a GramJS-backed {@link IGramClient} from module options and an initial
 * session string. The returned adapter is constructed but not yet connected.
 *
 * @param options - Validated client module options.
 * @param session - The initial string session (possibly empty).
 * @returns A new {@link GramJsClientAdapter}.
 * @throws Never (construction is synchronous and non-network).
 *
 * @example
 * ```ts
 * const client = createGramJsClient({ apiId, apiHash }, '');
 * await client.connect();
 * ```
 */
export function createGramJsClient(
  options: TelegramClientModuleOptions,
  session: string,
): IGramClient {
  const stringSession = new sessions.StringSession(session);
  const client = new TelegramClient(
    stringSession,
    options.apiId,
    options.apiHash,
    {
      connectionRetries: options.connectionRetries ?? 5,
      deviceModel: options.deviceModel,
      systemVersion: options.systemVersion,
      appVersion: options.appVersion,
      useWSS: options.useWSS ?? false,
      floodSleepThreshold: options.floodSleepThreshold,
    },
  );

  return new GramJsClientAdapter(client, stringSession, {
    apiId: options.apiId,
    apiHash: options.apiHash,
  });
}
