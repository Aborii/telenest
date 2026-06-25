/**
 * @file src/lib/client/gram-client.types.ts
 *
 * PURPOSE
 * -------
 * Library-owned data-transfer types for the MTProto side. The user-facing
 * services speak in these plain shapes rather than GramJS' rich `Api.*`
 * classes, so consumers (and unit tests) never need to import GramJS to model
 * a user, a dialog, or a message. The GramJS adapter is the single place that
 * maps `Api.*` objects into these DTOs.
 *
 * USAGE
 * -----
 * ```ts
 * const me: GramUser = await client.getMe();
 * ```
 *
 * KEY EXPORTS
 * -----------
 * - GramPeer: Accepted peer reference (`'me'`, @username, or numeric id).
 * - GramUser / GramDialog / GramMessage: Normalized result DTOs.
 * - GramSignInResult: Discriminated result of a code sign-in step.
 * - Param objects for `getDialogs` / `getMessages` / `sendMessage`.
 */

/**
 * A peer reference accepted by the client: the literal `'me'` (your own Saved
 * Messages / account), a public `@username`, or a numeric user/chat id. The
 * `'me'` member is spelled out so editors suggest it, while `(string & {})`
 * keeps the union open to any other handle without collapsing to `string`.
 */
export type GramPeer = 'me' | (string & {}) | number;

/** Normalized Telegram account/user information. */
export interface GramUser {
  /** Telegram user id, rendered as a decimal string (ids exceed 2^53). */
  id: string;
  /** Whether this user object represents the logged-in account itself. */
  isSelf: boolean;
  /** Whether the account is a bot. */
  isBot: boolean;
  /** Whether the account has Telegram Premium. */
  isPremium: boolean;
  /** First name, when set. */
  firstName?: string;
  /** Last name, when set. */
  lastName?: string;
  /** Public @username (without the leading `@`), when set. */
  username?: string;
  /** Phone number in international format, when visible. */
  phone?: string;
}

/**
 * Closed set of dialog kinds. Declared as an `as const` record (never an
 * `enum`) so {@link GramDialogType} can be derived from it.
 */
export const GRAM_DIALOG_TYPES = {
  /** One-to-one private chat with a user. */
  USER: 'user',
  /** Basic group or supergroup. */
  GROUP: 'group',
  /** Broadcast channel. */
  CHANNEL: 'channel',
} as const;

/** Union of the dialog kinds in {@link GRAM_DIALOG_TYPES}. */
export type GramDialogType =
  (typeof GRAM_DIALOG_TYPES)[keyof typeof GRAM_DIALOG_TYPES];

/** Normalized entry from the account's dialog (conversation) list. */
export interface GramDialog {
  /** Peer id rendered as a decimal string. */
  id: string;
  /** Display title (chat title or the user's name). */
  title: string;
  /** Whether the dialog is a user chat, group, or channel. */
  type: GramDialogType;
  /** Number of unread messages. */
  unreadCount: number;
  /** Whether the dialog is pinned to the top of the list. */
  pinned: boolean;
}

/** Normalized Telegram message. */
export interface GramMessage {
  /** Message id within its chat. */
  id: number;
  /** Peer id (chat/user the message belongs to) as a decimal string. */
  peerId: string;
  /** Plain-text body (empty for non-text/service messages). */
  text: string;
  /** Unix timestamp (seconds) the message was sent. */
  date: number;
  /** Whether the message was sent by the logged-in account. */
  out: boolean;
  /** Sender id as a decimal string, when known. */
  senderId?: string;
  /**
   * Whether the message carries downloadable media (photo, document, video,
   * …). Always populated by the GramJS adapter; optional on the DTO because
   * a hand-built {@link import('./gram-client.interface').IGramClient} fake may
   * omit it. When `true`, the media can be fetched with
   * {@link import('./gram-client.interface').IGramClient.downloadMedia} using
   * this message's `peerId` and `id`. Service/empty media never counts.
   */
  hasMedia?: boolean;
}

/** Result of {@link import('./gram-client.interface').IGramClient.sendCode}. */
export interface GramSendCodeResult {
  /** Opaque hash echoed back to `signInWithCode` to complete the login. */
  phoneCodeHash: string;
  /** Whether the code was delivered in-app rather than by SMS. */
  isCodeViaApp: boolean;
}

/**
 * Closed set of sign-in step outcomes. Declared as an `as const` record so
 * {@link GramSignInStatus} can be derived from it.
 */
export const GRAM_SIGN_IN_STATUSES = {
  /** The account is fully signed in. */
  AUTHORIZED: 'authorized',
  /** The code was accepted but a 2FA password is still required. */
  PASSWORD_REQUIRED: 'password-required',
} as const;

/** Union of the sign-in outcomes in {@link GRAM_SIGN_IN_STATUSES}. */
export type GramSignInStatus =
  (typeof GRAM_SIGN_IN_STATUSES)[keyof typeof GRAM_SIGN_IN_STATUSES];

/**
 * Discriminated result of a code-based sign-in attempt. When `status` is
 * `'password-required'`, the caller must collect the user's 2FA password and
 * call `signInWithPassword`.
 */
export type GramSignInResult =
  | {
      /** Sign-in completed; `user` describes the logged-in account. */
      status: typeof GRAM_SIGN_IN_STATUSES.AUTHORIZED;
      /** The authenticated account. */
      user: GramUser;
    }
  | {
      /** A 2FA password is required to finish signing in. */
      status: typeof GRAM_SIGN_IN_STATUSES.PASSWORD_REQUIRED;
    };

/** Input for {@link import('./gram-client.interface').IGramClient.signInWithCode}. */
export interface GramSignInWithCodeInput {
  /** Phone number used with `sendCode`, in international format. */
  phoneNumber: string;
  /** The `phoneCodeHash` returned by `sendCode`. */
  phoneCodeHash: string;
  /** The login code the user received. */
  phoneCode: string;
}

/**
 * A QR login token issued during
 * {@link import('./gram-client.interface').IGramClient.signInWithQrCode}.
 *
 * Telegram rotates the token roughly every 30 seconds until it is scanned, so a
 * QR login surfaces a *sequence* of these rather than a single static value —
 * always render the most recent `url`.
 */
export interface GramQrToken {
  /**
   * The login token, base64url-encoded. This is the same value embedded in
   * {@link GramQrToken.url}; exposed separately for callers that build their own
   * deep-link or QR payload.
   */
  token: string;
  /**
   * The `tg://login?token=…` deep link to render as a scannable QR code. When
   * scanned by an already-authorized Telegram app, it authorizes this session.
   */
  url: string;
  /** Unix timestamp (seconds) at which this token expires and a new one is issued. */
  expires: number;
}

/**
 * Callbacks driving
 * {@link import('./gram-client.interface').IGramClient.signInWithQrCode}.
 */
export interface GramQrSignInCallbacks {
  /**
   * Invoked with each freshly issued {@link GramQrToken} — once at the start and
   * again whenever Telegram rotates the token before it expires. Render the
   * latest `url` as a QR code for the user to scan.
   */
  onToken: (token: GramQrToken) => void;
  /**
   * Invoked when the scanned account has 2FA enabled: must resolve the account's
   * two-step-verification password (the `hint`, if any, is Telegram's stored
   * password hint). When omitted, a 2FA-protected account cannot complete QR
   * login and the attempt rejects with a `PASSWORD_REQUIRED`
   * {@link import('../common').TelegramAuthError}.
   */
  onPassword?: (hint?: string) => Promise<string>;
}

/**
 * Input for
 * {@link import('./gram-client.interface').IGramClient.updateTwoFactor}.
 *
 * The combination of fields selects the operation:
 * - **enable**: `newPassword` set, `currentPassword` omitted.
 * - **change**: both `currentPassword` and `newPassword` set.
 * - **remove**: `currentPassword` set, `newPassword` omitted (or empty).
 */
export interface GramUpdateTwoFactorInput {
  /**
   * The current 2FA password. Required when changing or removing an existing
   * password; omit it when enabling 2FA for the first time.
   */
  currentPassword?: string;
  /**
   * The new 2FA password. Omit (or pass an empty string) together with
   * `currentPassword` to remove 2FA entirely.
   */
  newPassword?: string;
  /** Hint Telegram shows at the 2FA prompt. Ignored when `newPassword` is unset. */
  hint?: string;
}

/** Parameters for listing dialogs. */
export interface GramGetDialogsParams {
  /** Maximum number of dialogs to return (default: GramJS default). */
  limit?: number;
  /** Include archived dialogs. Defaults to `false`. */
  archived?: boolean;
}

/** Parameters for fetching messages from a peer. */
export interface GramGetMessagesParams {
  /** Maximum number of messages to return. */
  limit?: number;
  /** Only return messages with an id greater than this (for pagination). */
  minId?: number;
  /** Only return messages with an id less than this (for pagination). */
  maxId?: number;
}

/**
 * Closed set of MTProto text parse modes. Declared as an `as const` record so
 * {@link GramParseMode} can be derived from it.
 */
export const GRAM_PARSE_MODES = {
  /** HTML formatting. */
  HTML: 'html',
  /** Markdown formatting. */
  MARKDOWN: 'md',
} as const;

/** Union of MTProto parse modes in {@link GRAM_PARSE_MODES}. */
export type GramParseMode =
  (typeof GRAM_PARSE_MODES)[keyof typeof GRAM_PARSE_MODES];

/** Parameters for sending a message as the logged-in account. */
export interface GramSendMessageParams {
  /** Message text. */
  message: string;
  /** Optional formatting mode applied to `message`. */
  parseMode?: GramParseMode;
  /** Id of the message to reply to. */
  replyTo?: number;
  /** Send without a notification sound. */
  silent?: boolean;
}

/**
 * A file accepted by {@link import('./gram-client.interface').IGramClient.sendFile}:
 * a local filesystem path, a public direct URL (Telegram fetches it), or an
 * in-memory {@link Buffer}. To control the filename of a `Buffer` upload, attach
 * a `name` property to it (`Object.assign(buf, { name: 'report.pdf' })`).
 */
export type GramInputFile = string | Buffer;

/** Parameters for sending a file as the logged-in account. */
export interface GramSendFileParams {
  /** The file to send (local path, direct URL, or {@link Buffer}). */
  file: GramInputFile;
  /** Optional caption shown beneath the media. */
  caption?: string;
  /**
   * How to present an image/video file. `true` sends it as a viewable photo/
   * video; `false` forces it as a downloadable document; omitted lets Telegram
   * infer from the file extension (images/videos become media, else document).
   */
  asPhoto?: boolean;
  /** Optional formatting mode applied to `caption`. */
  parseMode?: GramParseMode;
  /** Id of the message to reply to. */
  replyTo?: number;
  /** Send without a notification sound. */
  silent?: boolean;
}

/** Parameters for listing a chat's or channel's participants. */
export interface GramGetParticipantsParams {
  /**
   * Maximum number of participants to return. **When omitted, every
   * participant is fetched** (GramJS' default) — on a large group/channel this
   * is slow and can trigger `FLOOD_WAIT`. Set a `limit` unless you truly need
   * the full roster.
   */
  limit?: number;
  /** Filter participants by a display-name / username query. */
  search?: string;
}

/** Parameters for searching messages within a peer. */
export interface GramSearchMessagesParams {
  /** Maximum number of matching messages to return. */
  limit?: number;
}

/** Parameters for deleting messages. */
export interface GramDeleteMessagesParams {
  /**
   * Delete the messages for everyone in the chat (not just your own copy).
   * Defaults to `true`.
   */
  revoke?: boolean;
}

/** Parameters for pinning a message. */
export interface GramPinMessageParams {
  /**
   * Notify chat members about the pin. Defaults to `false` (silent pin), which
   * mirrors GramJS' default rather than the official clients' behaviour.
   */
  notify?: boolean;
}

/**
 * Extended ("full") information about a chat, channel, or user, returned by
 * {@link import('./gram-client.interface').IGramClient.getFullChat}. Richer than
 * a {@link GramDialog}: it carries the description/bio and (for groups and
 * channels) the participant count.
 */
export interface GramChatInfo {
  /** Peer id rendered as a decimal string. */
  id: string;
  /** Whether the peer is a user, group, or channel. */
  type: GramDialogType;
  /** Display title — the chat/channel title, or the user's full name. */
  title: string;
  /** Public @username (without the leading `@`), when set. */
  username?: string;
  /** Bio (user) or description (group/channel), when set. */
  about?: string;
  /** Member count for groups and channels; `undefined` for users. */
  participantsCount?: number;
  /** Whether the peer carries Telegram's verified badge. */
  verified: boolean;
}

/**
 * Closed set of media kinds reported by
 * {@link import('./gram-client.interface').IGramClient.getMediaInfo}. Declared
 * as an `as const` record (never an `enum`) so {@link GramMediaKind} derives
 * from it.
 */
export const GRAM_MEDIA_KINDS = {
  /** A photo. */
  PHOTO: 'photo',
  /** A video document. */
  VIDEO: 'video',
  /** A music / audio document. */
  AUDIO: 'audio',
  /** A voice note. */
  VOICE: 'voice',
  /** Any other document (file, gif, sticker, …). */
  DOCUMENT: 'document',
} as const;

/** Union of the media kinds in {@link GRAM_MEDIA_KINDS}. */
export type GramMediaKind =
  (typeof GRAM_MEDIA_KINDS)[keyof typeof GRAM_MEDIA_KINDS];

/**
 * GramJS-free descriptor of a message's media, returned by
 * {@link import('./gram-client.interface').IGramClient.getMediaInfo}. Carries
 * exactly what an HTTP layer needs to serve the bytes (Content-Type,
 * Content-Length, Accept-Ranges) plus light playback metadata.
 */
export interface GramMediaInfo {
  /** Which kind of media this is. */
  kind: GramMediaKind;
  /** MIME type (e.g. `'video/mp4'`), when known. */
  mimeType?: string;
  /**
   * Total size in bytes, when known. A `number` is safe: Telegram media is far
   * below `2^53` bytes (unlike entity ids, which are returned as strings).
   */
  size?: number;
  /** Original file name, when present. */
  fileName?: string;
  /** Duration in seconds for video / audio / voice, when known. */
  durationSeconds?: number;
  /** Pixel width for video, when known. */
  width?: number;
  /** Pixel height for video, when known. */
  height?: number;
  /**
   * Whether the uploader flagged the video as streamable (clients can play it
   * before the full download completes).
   */
  supportsStreaming?: boolean;
}

/** A byte range for {@link import('./gram-client.interface').IGramClient.downloadMediaRange}. */
export interface GramMediaRange {
  /** Zero-based byte offset to start at. */
  offset: number;
  /** Number of bytes to return (the response may be shorter at end-of-file). */
  limit: number;
}

/** Options for {@link import('./gram-client.interface').IGramClient.streamMedia}. */
export interface GramStreamMediaOptions {
  /** Zero-based byte offset to start streaming from. Defaults to `0`. */
  offset?: number;
  /** Maximum number of bytes to stream. Defaults to "until end-of-file". */
  limit?: number;
}

// ── Inbound update events ────────────────────────────────────────────────────

/**
 * Normalized "messages were deleted" event, delivered to
 * {@link import('./gram-client.interface').IGramClient.onDeletedMessages}
 * subscribers (and `@OnUserDeleted` handlers).
 *
 * Telegram only reports *where* a deletion happened for channels and
 * supergroups; for private chats and small groups it omits the peer (message
 * ids are globally unique there, so the chat can be recovered from a saved id
 * alone). Hence {@link GramDeletedMessages.peerId} is optional — expect it to be
 * present only for channel/supergroup deletions.
 */
export interface GramDeletedMessages {
  /** Ids of the messages that were deleted. */
  messageIds: number[];
  /**
   * Peer id (decimal string) the deletion occurred in, when Telegram reports
   * it — present only for channels/supergroups, `undefined` otherwise.
   */
  peerId?: string;
}

/**
 * Closed set of chat-action kinds surfaced by
 * {@link import('./gram-client.interface').IGramClient.onChatAction} (and
 * `@OnChatAction` handlers). Declared as an `as const` record (never an `enum`,
 * per repo conventions) so {@link GramChatAction} and
 * {@link GRAM_CHAT_ACTION_VALUES} derive from it.
 *
 * The members cover Telegram's transient "user is doing X" signals
 * (`SendMessageAction`) plus the two coarse online/offline presence
 * transitions. Any action this library does not model maps to
 * {@link GRAM_CHAT_ACTIONS.UNKNOWN}.
 */
export const GRAM_CHAT_ACTIONS = {
  /** The user is typing a text message. */
  TYPING: 'typing',
  /** The user explicitly cleared their action (stopped typing/recording). */
  CANCEL: 'cancel',
  /** The user is recording a video. */
  RECORDING_VIDEO: 'recording-video',
  /** The user is uploading a video. */
  UPLOADING_VIDEO: 'uploading-video',
  /** The user is recording a voice note. */
  RECORDING_VOICE: 'recording-voice',
  /** The user is uploading a voice/audio file. */
  UPLOADING_AUDIO: 'uploading-audio',
  /** The user is uploading a photo. */
  UPLOADING_PHOTO: 'uploading-photo',
  /** The user is uploading a document/file. */
  UPLOADING_DOCUMENT: 'uploading-document',
  /** The user is recording a round (video-note) message. */
  RECORDING_ROUND: 'recording-round',
  /** The user is uploading a round (video-note) message. */
  UPLOADING_ROUND: 'uploading-round',
  /** The user is picking a geo location to share. */
  PICKING_LOCATION: 'picking-location',
  /** The user is choosing a contact to share. */
  CHOOSING_CONTACT: 'choosing-contact',
  /** The user is choosing a sticker. */
  CHOOSING_STICKER: 'choosing-sticker',
  /** The user is playing an embedded game. */
  PLAYING_GAME: 'playing-game',
  /** The user just came online. */
  ONLINE: 'online',
  /** The user just went offline. */
  OFFLINE: 'offline',
  /** An action this library does not model individually. */
  UNKNOWN: 'unknown',
} as const;

/** Union of the chat-action kinds in {@link GRAM_CHAT_ACTIONS}. */
export type GramChatAction =
  (typeof GRAM_CHAT_ACTIONS)[keyof typeof GRAM_CHAT_ACTIONS];

/** Readonly array form of {@link GRAM_CHAT_ACTIONS} for iteration/validation. */
export const GRAM_CHAT_ACTION_VALUES = Object.values(
  GRAM_CHAT_ACTIONS,
) as readonly GramChatAction[];

/**
 * Normalized chat-action event, delivered to
 * {@link import('./gram-client.interface').IGramClient.onChatAction}
 * subscribers (and `@OnChatAction` handlers). Models both the transient
 * "user is typing / recording / …" signals and online/offline presence changes.
 */
export interface GramChatActionEvent {
  /**
   * Peer id (decimal string) the action occurred in. For a one-to-one typing /
   * presence update this is the user's own id; for a group/channel it is the
   * chat id.
   */
  peerId: string;
  /**
   * Id (decimal string) of the user performing the action, when known. Omitted
   * only when Telegram does not attribute the action to a resolvable user.
   */
  userId?: string;
  /** Which action the user is performing. */
  action: GramChatAction;
}
