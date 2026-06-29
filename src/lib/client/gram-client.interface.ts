/**
 * @file src/lib/client/gram-client.interface.ts
 *
 * PURPOSE
 * -------
 * The abstraction boundary between this library's MTProto services and GramJS.
 * Services depend only on {@link IGramClient}; the concrete GramJS adapter is
 * the single implementation that touches the `telegram` package. This makes
 * every service unit-testable with a trivial in-memory fake and keeps GramJS
 * out of consumer compilation units.
 *
 * USAGE
 * -----
 * ```ts
 * const fake: IGramClient = { getMe: async () => me, ... };
 * const service = new TelegramUserService(fake);
 * ```
 *
 * KEY EXPORTS
 * -----------
 * - IGramClient: Minimal, fully-typed client surface used by the services.
 */

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
  GramQrSignInCallbacks,
  GramSearchMessagesParams,
  GramSendCodeResult,
  GramSendFileParams,
  GramSendMessageParams,
  GramSignInResult,
  GramSignInWithCodeInput,
  GramStreamMediaOptions,
  GramUpdateTwoFactorInput,
  GramUser,
} from './gram-client.types';

/**
 * Minimal MTProto client surface consumed by {@link import('./telegram-auth.service').TelegramAuthService}
 * and {@link import('./telegram-user.service').TelegramUserService}. Every method
 * returns library DTOs (never raw GramJS `Api.*` objects), so the public API is
 * stable across GramJS upgrades.
 */
export interface IGramClient {
  /**
   * Opens the MTProto connection. Idempotent.
   *
   * @returns Resolves once connected.
   * @throws {import('../common').TelegramClientError} On transport failure.
   */
  connect(): Promise<void>;

  /**
   * Closes the MTProto connection. Idempotent.
   *
   * @returns Resolves once disconnected.
   * @throws Never (disconnect errors are swallowed).
   */
  disconnect(): Promise<void>;

  /**
   * @returns Whether the client currently holds an open connection.
   * @throws Never.
   */
  isConnected(): boolean;

  /**
   * @returns Whether the current session is authorized (logged in).
   * @throws {import('../common').TelegramClientError} On transport failure.
   */
  isAuthorized(): Promise<boolean>;

  /**
   * Requests a login code be sent to the given phone number.
   *
   * @param phoneNumber - Phone number in international format (e.g. `+15551234`).
   * @param forceSMS - Force SMS delivery instead of the in-app code.
   * @returns The `phoneCodeHash` needed to complete sign-in.
   * @throws {import('../common').TelegramAuthError} If the phone is rejected.
   */
  sendCode(
    phoneNumber: string,
    forceSMS?: boolean,
  ): Promise<GramSendCodeResult>;

  /**
   * Completes sign-in with the code the user received.
   *
   * @param input - Phone number, `phoneCodeHash`, and the received code.
   * @returns `authorized` with the user, or `password-required` when 2FA is on.
   * @throws {import('../common').TelegramAuthError} If the code is invalid.
   */
  signInWithCode(input: GramSignInWithCodeInput): Promise<GramSignInResult>;

  /**
   * Completes a 2FA-protected sign-in with the account password.
   *
   * @param password - The account's two-step-verification password.
   * @returns The authenticated account.
   * @throws {import('../common').TelegramAuthError} If the password is wrong.
   */
  signInWithPassword(password: string): Promise<GramUser>;

  /**
   * Signs in by QR code: scan the rendered token from an already-authorized
   * Telegram app to authorize this session. Resolves once scanned (and, for a
   * 2FA-protected account, once `callbacks.onPassword` supplies the password).
   *
   * @param callbacks - `onToken` receives each issued/rotated QR token to
   *   render; `onPassword` resolves the 2FA password when required.
   * @returns The authenticated account.
   * @throws {import('../common').TelegramAuthError} If the login fails, or a 2FA
   *   account is scanned without an `onPassword` callback (`PASSWORD_REQUIRED`).
   */
  signInWithQrCode(callbacks: GramQrSignInCallbacks): Promise<GramUser>;

  /**
   * Signs in as a bot using a BotFather token over the MTProto transport.
   *
   * @param botToken - The bot token from BotFather (`<id>:<secret>`).
   * @returns The authenticated bot account.
   * @throws {import('../common').TelegramAuthError} If the token is rejected.
   */
  signInAsBot(botToken: string): Promise<GramUser>;

  /**
   * Enables, changes, or removes the account's two-factor (2FA) password.
   * Requires an already-authorized session.
   *
   * @param input - Current/new password and hint selecting the operation.
   * @returns Resolves once the password settings are updated.
   * @throws {import('../common').TelegramAuthError} If the current password is
   *   wrong (`PASSWORD_INVALID`) or the update otherwise fails.
   */
  updateTwoFactor(input: GramUpdateTwoFactorInput): Promise<void>;

  /**
   * Logs out, invalidating the current session on Telegram's servers.
   *
   * @returns Resolves once logged out.
   * @throws {import('../common').TelegramClientError} On transport failure.
   */
  logOut(): Promise<void>;

  /**
   * @returns The logged-in account's profile.
   * @throws {import('../common').TelegramClientError} If not authorized.
   */
  getMe(): Promise<GramUser>;

  /**
   * Lists the account's dialogs (conversations).
   *
   * @param params - Optional limit / archived filter.
   * @returns The dialog list.
   * @throws {import('../common').TelegramClientError} On failure.
   */
  getDialogs(params?: GramGetDialogsParams): Promise<GramDialog[]>;

  /**
   * Fetches recent messages from a peer.
   *
   * @param peer - Target peer (`'me'`, @username, or numeric id).
   * @param params - Optional limit / pagination bounds.
   * @returns The messages, newest first.
   * @throws {import('../common').TelegramClientError} On failure.
   */
  getMessages(
    peer: GramPeer,
    params?: GramGetMessagesParams,
  ): Promise<GramMessage[]>;

  /**
   * Sends a message as the logged-in account.
   *
   * @param peer - Target peer (`'me'`, @username, or numeric id).
   * @param params - Message text and options.
   * @returns The sent message.
   * @throws {import('../common').TelegramClientError} On failure.
   */
  sendMessage(
    peer: GramPeer,
    params: GramSendMessageParams,
  ): Promise<GramMessage>;

  // ── Media ──────────────────────────────────────────────────────────────────

  /**
   * Sends a file (photo, video, document, …) as the logged-in account.
   *
   * @param peer - Target peer (`'me'`, @username, or numeric id).
   * @param params - The file plus optional caption / presentation options.
   * @returns The sent message.
   * @throws {import('../common').TelegramClientError} On failure.
   */
  sendFile(peer: GramPeer, params: GramSendFileParams): Promise<GramMessage>;

  /**
   * Downloads the media attached to a message into a {@link Buffer}.
   *
   * @param peer - Peer the message belongs to (`'me'`, @username, or numeric id).
   * @param messageId - Id of the message whose media to download.
   * @returns The media bytes, or `undefined` when the message has no
   *   downloadable media (or no longer exists).
   * @throws {import('../common').TelegramClientError} On failure.
   */
  downloadMedia(peer: GramPeer, messageId: number): Promise<Buffer | undefined>;

  /**
   * Downloads a peer's current profile photo into a {@link Buffer}.
   *
   * @param peer - Target peer (`'me'`, @username, or numeric id).
   * @returns The photo bytes, or `undefined` when the peer has no photo.
   * @throws {import('../common').TelegramClientError} On failure.
   */
  downloadProfilePhoto(peer: GramPeer): Promise<Buffer | undefined>;

  /**
   * Returns metadata about a message's media (kind, MIME, size, dimensions, …)
   * without downloading the bytes — enough to populate an HTTP `Content-Type` /
   * `Content-Length` / `Accept-Ranges` response.
   *
   * @param peer - Peer the message belongs to (`'me'`, @username, or numeric id).
   * @param messageId - Id of the message whose media to describe.
   * @returns The media descriptor, or `undefined` when the message has no
   *   downloadable media (or no longer exists).
   * @throws {import('../common').TelegramClientError} On failure.
   */
  getMediaInfo(
    peer: GramPeer,
    messageId: number,
  ): Promise<GramMediaInfo | undefined>;

  /**
   * Downloads a single contiguous byte range of a message's media — the
   * building block for serving HTTP `206 Partial Content` responses so a player
   * can seek without fetching the whole file.
   *
   * @param peer - Peer the message belongs to (`'me'`, @username, or numeric id).
   * @param messageId - Id of the message whose media to read.
   * @param range - Zero-based byte `offset` and byte `limit` to return.
   * @returns The requested bytes (shorter than `limit` at end-of-file), or
   *   `undefined` when the message has no downloadable media.
   * @throws {import('../common').TelegramClientError} On failure.
   */
  downloadMediaRange(
    peer: GramPeer,
    messageId: number,
    range: GramMediaRange,
  ): Promise<Buffer | undefined>;

  /**
   * Streams a message's media as a lazy sequence of byte chunks, optionally
   * starting at an `offset` and bounded by a `limit` — pipe it straight to an
   * HTTP response for progressive playback without buffering the whole file.
   *
   * @param peer - Peer the message belongs to (`'me'`, @username, or numeric id).
   * @param messageId - Id of the message whose media to stream.
   * @param options - Optional byte `offset` / `limit`.
   * @returns An async iterable of byte chunks.
   * @throws {import('../common').TelegramClientError} If the message has no
   *   downloadable media, or on transport failure.
   */
  streamMedia(
    peer: GramPeer,
    messageId: number,
    options?: GramStreamMediaOptions,
  ): Promise<AsyncIterable<Buffer>>;

  // ── Chats & channels ───────────────────────────────────────────────────────

  /**
   * Joins a public channel or group.
   *
   * @param peer - The channel/group to join (@username or numeric id).
   * @returns Resolves once joined.
   * @throws {import('../common').TelegramClientError} On failure.
   */
  joinChannel(peer: GramPeer): Promise<void>;

  /**
   * Leaves a channel or group.
   *
   * @param peer - The channel/group to leave (@username or numeric id).
   * @returns Resolves once left.
   * @throws {import('../common').TelegramClientError} On failure.
   */
  leaveChannel(peer: GramPeer): Promise<void>;

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
  getParticipants(
    peer: GramPeer,
    params?: GramGetParticipantsParams,
  ): Promise<GramUser[]>;

  /**
   * Searches a peer's history for messages matching a text query.
   *
   * @param peer - Target peer (`'me'`, @username, or numeric id).
   * @param query - The text to search for.
   * @param params - Optional limit.
   * @returns The matching messages, newest first.
   * @throws {import('../common').TelegramClientError} On failure.
   */
  searchMessages(
    peer: GramPeer,
    query: string,
    params?: GramSearchMessagesParams,
  ): Promise<GramMessage[]>;

  /**
   * Fetches extended ("full") information about a chat, channel, or user.
   *
   * @param peer - Target peer (`'me'`, @username, or numeric id).
   * @returns The chat/channel/user info DTO.
   * @throws {import('../common').TelegramClientError} On failure.
   */
  getFullChat(peer: GramPeer): Promise<GramChatInfo>;

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
  editMessage(
    peer: GramPeer,
    messageId: number,
    text: string,
  ): Promise<GramMessage>;

  /**
   * Deletes one or more messages from a chat.
   *
   * @param peer - Peer the messages belong to (`'me'`, @username, or numeric id).
   * @param messageIds - Ids of the messages to delete.
   * @param params - Optional `revoke` flag (delete for everyone; default `true`).
   * @returns Resolves once deleted.
   * @throws {import('../common').TelegramClientError} On failure.
   */
  deleteMessages(
    peer: GramPeer,
    messageIds: number[],
    params?: GramDeleteMessagesParams,
  ): Promise<void>;

  /**
   * Forwards messages from one peer to another.
   *
   * @param toPeer - Destination peer.
   * @param fromPeer - Source peer the messages currently live in.
   * @param messageIds - Ids of the messages to forward.
   * @returns The forwarded messages as they now exist in `toPeer`.
   * @throws {import('../common').TelegramClientError} On failure.
   */
  forwardMessages(
    toPeer: GramPeer,
    fromPeer: GramPeer,
    messageIds: number[],
  ): Promise<GramMessage[]>;

  /**
   * Marks a peer's history as read (clears the unread badge).
   *
   * @param peer - Target peer (`'me'`, @username, or numeric id).
   * @returns Resolves once acknowledged.
   * @throws {import('../common').TelegramClientError} On failure.
   */
  markAsRead(peer: GramPeer): Promise<void>;

  /**
   * Pins a message in a chat.
   *
   * @param peer - Peer the message belongs to (`'me'`, @username, or numeric id).
   * @param messageId - Id of the message to pin.
   * @param params - Optional `notify` flag.
   * @returns Resolves once pinned.
   * @throws {import('../common').TelegramClientError} On failure.
   */
  pinMessage(
    peer: GramPeer,
    messageId: number,
    params?: GramPinMessageParams,
  ): Promise<void>;

  /**
   * Serializes the current session to a portable string for persistence.
   *
   * @returns The string session (empty string when unauthenticated).
   * @throws Never.
   */
  exportSession(): string;

  /**
   * Subscribes to inbound new-message events for the logged-in account. The
   * handler receives each message as a normalized {@link GramMessage}.
   *
   * @param handler - Called for every new message while subscribed.
   * @returns An unsubscribe function that removes the handler. Idempotent.
   * @throws Never (registration is synchronous; transport errors surface
   *   elsewhere).
   */
  onNewMessage(handler: (message: GramMessage) => void): () => void;

  /**
   * Subscribes to message-edited events for the logged-in account. The handler
   * receives the edited message as a normalized {@link GramMessage} (its `text`
   * reflects the new content).
   *
   * @param handler - Called for every edited message while subscribed.
   * @returns An unsubscribe function that removes the handler. Idempotent.
   * @throws Never (registration is synchronous; transport errors surface
   *   elsewhere).
   */
  onEditedMessage(handler: (message: GramMessage) => void): () => void;

  /**
   * Subscribes to message-deleted events for the logged-in account. The handler
   * receives a {@link GramDeletedMessages} carrying the deleted ids and — for
   * channels/supergroups only — the originating peer.
   *
   * @param handler - Called for every deletion event while subscribed.
   * @returns An unsubscribe function that removes the handler. Idempotent.
   * @throws Never (registration is synchronous; transport errors surface
   *   elsewhere).
   */
  onDeletedMessages(handler: (event: GramDeletedMessages) => void): () => void;

  /**
   * Subscribes to chat-action events (typing, recording, online/offline, …) for
   * the logged-in account. The handler receives a normalized
   * {@link GramChatActionEvent}; actions this library does not model are
   * reported as {@link GRAM_CHAT_ACTIONS.UNKNOWN}.
   *
   * @param handler - Called for every chat-action event while subscribed.
   * @returns An unsubscribe function that removes the handler. Idempotent.
   * @throws Never (registration is synchronous; transport errors surface
   *   elsewhere).
   */
  onChatAction(handler: (event: GramChatActionEvent) => void): () => void;
}
