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
/**
 * An unsent draft saved on a dialog — what every official client shows in the
 * chat list ahead of the last message.
 *
 * Read-only: writing drafts (`messages.saveDraft`) is a separate surface. The
 * point of exposing it is that a draft typed on another device shows up here.
 */
export interface GramDialogDraft {
  /** The draft's plain text (empty for a media-only draft). */
  text: string;
  /** Unix timestamp (seconds) the draft was last edited. */
  date: number;
  /** Id of the message the draft replies to, when it is a reply. */
  replyToMsgId?: number;
}

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
  /**
   * Plain-text body of the dialog's most recent message, for a list preview.
   * Omitted when the last message has no text (service/media-only) or is not
   * available on the dialog object.
   */
  lastMessagePreview?: string;
  /**
   * Unix timestamp (seconds) of the dialog's most recent message, when
   * available — used to sort/label the conversation list.
   */
  lastMessageDate?: number;
  /**
   * Whether the account has muted notifications for this dialog. `undefined`
   * when the dialog object carries no notification settings (e.g. a hand-built
   * fake); a `boolean` otherwise.
   */
  muted?: boolean;
  /**
   * Whether the peer has a (non-empty) profile/chat photo — a cheap hint that
   * an avatar can be fetched. `undefined` when the peer entity is not resolved
   * on the dialog object.
   */
  hasPhoto?: boolean;
  /**
   * Id of the last **incoming** message the account has read in this dialog.
   * Messages with a greater id are unread — the anchor for "open at first
   * unread". `undefined` when the raw TL dialog is not present on the object
   * (e.g. a hand-built fake).
   */
  readInboxMaxId?: number;
  /**
   * Id of the last **outgoing** message the peer has read — drives read
   * receipts (an outgoing message with `id <= readOutboxMaxId` has been seen).
   * `undefined` when the raw TL dialog is not present on the object.
   */
  readOutboxMaxId?: number;
  /**
   * Id of the newest message in the dialog. Lets consumers detect when the
   * latest slice of history is loaded (end of newer-direction paging).
   * `undefined` when the raw TL dialog is not present on the object.
   */
  topMessageId?: number;
  /**
   * Whether the dialog's most recent message was sent by the logged-in
   * account (for a "You:" list-preview prefix). `undefined` when the dialog
   * carries no last message.
   */
  lastMessageOut?: boolean;
  /**
   * Best-effort display name of the last message's sender, populated **only**
   * when GramJS already resolved the sender entity on the message (no extra
   * network call — that would risk `FLOOD_WAIT`). `undefined` when the sender
   * is unresolved or there is no last message.
   */
  lastMessageSenderName?: string;
  /**
   * Media kind of the dialog's most recent message, for a list-preview
   * placeholder ("Photo", "Video", …) when the message has no text.
   * `undefined` for text-only/service last messages or when no last message
   * is available.
   */
  lastMessageMediaKind?: GramMediaKind;
  /**
   * Whether the peer is a bot account. Only meaningful for `user` dialogs
   * (always `false` for groups/channels); `undefined` when the peer entity is
   * not resolved on the dialog object. Drives the `bots` category of
   * {@link GramDialogFilter} membership.
   */
  isBot?: boolean;
  /**
   * Whether the peer is in the account's contacts. Only meaningful for `user`
   * dialogs (always `false` for groups/channels); `undefined` when the peer
   * entity is not resolved. Drives the `contacts`/`nonContacts` categories of
   * {@link GramDialogFilter} membership.
   */
  isContact?: boolean;
  /**
   * Whether the account manually marked this dialog as unread (independent of
   * {@link GramDialog.unreadCount}). A dialog counts as "read" for
   * {@link GramDialogFilter.excludeRead} only when `unreadCount` is `0` AND
   * this flag is not set. `undefined` when the raw TL dialog is not present.
   */
  unreadMark?: boolean;
  /**
   * The dialog's unsent draft, when it has one. Omitted for a dialog with no
   * draft — and for an EMPTY draft (`draftMessageEmpty`), which Telegram uses
   * to say a draft was cleared and which must not render as a "Draft:" row.
   */
  draft?: GramDialogDraft;
}

/** Normalized Telegram message. */
/**
 * Closed set of message-entity kinds — the formatting and semantic spans
 * Telegram sends alongside a message's text. Declared as an `as const` record
 * (never an `enum`) so {@link GramMessageEntityType} derives from it.
 *
 * Every `Api.MessageEntity*` variant telenest models has an entry; anything
 * Telegram adds later maps to `UNKNOWN` with its offsets intact, so a renderer
 * can skip the span rather than mis-styling it.
 */
export const GRAM_MESSAGE_ENTITY_TYPES = {
  /** Bold text. */
  BOLD: 'bold',
  /** Italic text. */
  ITALIC: 'italic',
  /** Underlined text. */
  UNDERLINE: 'underline',
  /** Struck-through text. */
  STRIKETHROUGH: 'strikethrough',
  /** Inline monospace. */
  CODE: 'code',
  /** Preformatted block, optionally carrying a language hint. */
  PRE: 'pre',
  /** Hidden until tapped. */
  SPOILER: 'spoiler',
  /** Quoted block, optionally collapsed. */
  BLOCKQUOTE: 'blockquote',
  /** A bare URL written out in the text. */
  URL: 'url',
  /** Text hyperlinked to a URL the text itself does not contain. */
  TEXT_URL: 'text-url',
  /** An email address. */
  EMAIL: 'email',
  /** A phone number. */
  PHONE: 'phone',
  /** An `@username` mention. */
  MENTION: 'mention',
  /** A mention of a user by id, for accounts with no username. */
  MENTION_NAME: 'mention-name',
  /** A `#hashtag`. */
  HASHTAG: 'hashtag',
  /** A `$CASHTAG`. */
  CASHTAG: 'cashtag',
  /** A `/command`. */
  BOT_COMMAND: 'bot-command',
  /** A custom emoji, rendered from a document. */
  CUSTOM_EMOJI: 'custom-emoji',
  /** A bank-card number. */
  BANK_CARD: 'bank-card',
  /** A kind this version does not model; offsets are still accurate. */
  UNKNOWN: 'unknown',
} as const;

/** Union of the entity kinds in {@link GRAM_MESSAGE_ENTITY_TYPES}. */
export type GramMessageEntityType =
  (typeof GRAM_MESSAGE_ENTITY_TYPES)[keyof typeof GRAM_MESSAGE_ENTITY_TYPES];

/**
 * One formatting or semantic span over a message's text.
 *
 * Offsets are **UTF-16 code units**, exactly as Telegram sends them, so they
 * index into a JavaScript string directly — but an emoji or other astral
 * character counts as two, which matters when slicing.
 */
export interface GramMessageEntity {
  /** What the span is. */
  type: GramMessageEntityType;
  /** Start offset into {@link GramMessage.text}, in UTF-16 code units. */
  offset: number;
  /** Length of the span, in UTF-16 code units. */
  length: number;
  /**
   * Target URL. Only on `text-url` — the one entity whose meaning is not
   * recoverable from the text it covers.
   */
  url?: string;
  /** Mentioned user id as a decimal string. Only on `mention-name`. */
  userId?: string;
  /** Syntax-highlighting hint. Only on `pre`, and only when Telegram sent one. */
  language?: string;
  /**
   * Custom-emoji document id as a decimal string. Only on `custom-emoji`; a
   * **string** because the id is 64-bit and can exceed `Number.MAX_SAFE_INTEGER`.
   */
  documentId?: string;
  /** Whether the quote renders collapsed. Only on `blockquote`. */
  collapsed?: boolean;
}

/**
 * Closed set of reaction kinds. Declared as an `as const` record (never an
 * `enum`) so {@link GramMessageReactionKind} derives from it.
 */
export const GRAM_MESSAGE_REACTION_KINDS = {
  /** A standard emoji reaction. */
  EMOJI: 'emoji',
  /** A custom-emoji reaction. */
  CUSTOM_EMOJI: 'custom-emoji',
  /** A Telegram Stars paid reaction. */
  PAID: 'paid',
} as const;

/** Union of the reaction kinds in {@link GRAM_MESSAGE_REACTION_KINDS}. */
export type GramMessageReactionKind =
  (typeof GRAM_MESSAGE_REACTION_KINDS)[keyof typeof GRAM_MESSAGE_REACTION_KINDS];

/**
 * One aggregated reaction under a message — the chip a client renders, with
 * its total and whether this account is part of it.
 *
 * Who reacted (`recent_reactions`) is deliberately not modelled: the aggregate
 * row is what every client shows by default, and the avatar list needs peer
 * resolution this mapping does not do.
 */
export interface GramMessageReaction {
  /** Which of the three reaction forms this is. */
  kind: GramMessageReactionKind;
  /** The emoji itself. Only on `emoji`. */
  emoticon?: string;
  /**
   * Custom-emoji document id as a decimal string. Only on `custom-emoji`; a
   * **string** for the same 64-bit reason as
   * {@link GramMessageEntity.documentId}.
   */
  documentId?: string;
  /** How many accounts chose this reaction. */
  count: number;
  /** Whether the logged-in account is one of them. */
  chosen: boolean;
}

/**
 * Where a forwarded message originally came from — what a client renders as
 * the "Forwarded from X" header.
 *
 * {@link GramMessageForward.fromId} and {@link GramMessageForward.fromName} are
 * separate on purpose: a name WITHOUT an id is Telegram's privacy case, where
 * the original sender disallowed linking back, and a client must render the
 * name as plain text rather than a link.
 */
export interface GramMessageForward {
  /** Original sender's peer id as a decimal string, when not hidden. */
  fromId?: string;
  /** Original sender's display name, when Telegram sent one. */
  fromName?: string;
  /** Unix timestamp (seconds) of the ORIGINAL message, not the forward. */
  date: number;
  /** Original message id inside the source channel, for a channel post. */
  channelPost?: number;
  /** Signature carried over from a signed channel post. */
  postAuthor?: string;
}

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
  /**
   * Id of the message this one replies to, when it is a reply. Omitted for
   * non-reply messages (and for replies to non-message targets, e.g. stories).
   */
  replyToMsgId?: number;
  /**
   * Whether the message has been edited. Present (and `true`) only when an
   * {@link GramMessage.editDate} is set; omitted otherwise.
   */
  edited?: boolean;
  /** Unix timestamp (seconds) of the last edit, when the message was edited. */
  editDate?: number;
  /**
   * GramJS-free descriptor of the message's media, when it carries downloadable
   * media that resolves to a file body. Omitted for text-only or service
   * messages (and for media with no byte body, e.g. a web-page preview).
   */
  media?: GramMediaInfo;
  /**
   * Best-effort display name of the sender, populated **only** when GramJS has
   * already resolved the sender entity on the message object (no extra network
   * call is made to fetch it — that would risk `FLOOD_WAIT`). Omitted when the
   * sender is unresolved; callers should fall back to {@link GramMessage.senderId}.
   */
  senderName?: string;
  /**
   * Media-group (album) id as a decimal string — messages sent together as one
   * album share the same value, letting consumers collapse them into a single
   * grouped bubble. A **string** because the id is a random 64-bit value that
   * can exceed `Number.MAX_SAFE_INTEGER`. Omitted for non-album messages.
   */
  groupedId?: string;
  /**
   * Formatting and semantic spans over {@link GramMessage.text}, in the order
   * Telegram sent them. Omitted when the message carries none.
   *
   * Without these the text is only its characters: bold and spoilers vanish,
   * and a `text-url` link loses its target entirely, since the URL lives on
   * the entity rather than in the text it covers.
   */
  entities?: GramMessageEntity[];
  /**
   * Aggregated reactions in Telegram's display order. Omitted when the message
   * has none.
   *
   * These are a SNAPSHOT from the read that produced this message: reaction
   * changes arrive as `updateMessageReactions`, which is not a message edit,
   * so they do not surface on the edit stream. A refetch refreshes them.
   */
  reactions?: GramMessageReaction[];
  /**
   * Where the message came from, when it was forwarded. Omitted otherwise.
   *
   * Without it a forward is indistinguishable from something the sender wrote,
   * which misattributes the words rather than merely losing decoration.
   */
  forward?: GramMessageForward;
  /**
   * `@username` of the bot the message was sent through (an inline result),
   * without the `@`. Omitted when the message did not come through a bot, or
   * when the bot is not among the entities GramJS already resolved — the same
   * no-extra-round-trip rule {@link GramMessage.senderName} follows.
   */
  viaBotUsername?: string;
  /**
   * Signature on a signed channel post ("— Jane"). Omitted elsewhere.
   *
   * A signed channel post is exactly the case where {@link GramMessage.senderId}
   * is absent, so without this the post has no attribution at all.
   */
  postAuthor?: string;
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
 * A secret-free summary of the web session authorized by
 * {@link import('./gram-client.interface').IGramClient.acceptLoginToken}.
 *
 * Mapped from the MTProto `Authorization` object Telegram returns when an
 * already-signed-in client approves another client's QR login token. It carries
 * only display metadata describing the *newly authorized* session — never the
 * token, session string, or any credential — so it is safe to log or surface to
 * the operator who confirmed the login.
 */
export interface GramAcceptedLoginSession {
  /** Name of the application that requested the login (e.g. `Telegram Web`). */
  appName: string;
  /** Device model reported by the authorized client (e.g. `Chrome`). */
  deviceModel: string;
  /** Platform the authorized client runs on (e.g. `Web`, `Windows`). */
  platform: string;
  /** OS/system version string reported by the authorized client, when set. */
  systemVersion?: string;
  /** Application version string reported by the authorized client, when set. */
  appVersion?: string;
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

/**
 * Closed set of dialog-filter (chat folder) kinds. Declared as an `as const`
 * record (never an `enum`) so {@link GramDialogFilterType} can be derived.
 */
export const GRAM_DIALOG_FILTER_TYPES = {
  /**
   * The account's "All Chats" pseudo-folder. Telegram returns it inside the
   * filter list purely to mark where the "All Chats" tab sits after the user
   * reordered their folders; it has no id, title, or rules of its own.
   */
  DEFAULT: 'default',
  /** A regular user-defined folder with category flags and peer lists. */
  FILTER: 'filter',
  /**
   * A shared folder joined via a chat-folder invite link. Membership is
   * defined ONLY by its `pinnedPeerIds`/`includePeerIds` — it has no category
   * flags and no exclusions (those fields are always `false`/empty).
   */
  CHATLIST: 'chatlist',
} as const;

/** Union of the folder kinds in {@link GRAM_DIALOG_FILTER_TYPES}. */
export type GramDialogFilterType =
  (typeof GRAM_DIALOG_FILTER_TYPES)[keyof typeof GRAM_DIALOG_FILTER_TYPES];

/**
 * Normalized dialog filter (a "chat folder" in Telegram's UI), as returned by
 * {@link import('./gram-client.interface').IGramClient.getDialogFilters}.
 *
 * A dialog belongs to the folder when it is NOT in `excludePeerIds`, and
 * either appears in `pinnedPeerIds`/`includePeerIds` (which override every
 * exclusion flag) or matches one of the enabled category flags without being
 * knocked out by an `exclude*` flag. All peer ids use the same GramJS
 * *marked* format as {@link GramDialog.id} (users unmarked, basic chats
 * `-<id>`, channels/supergroups `-100<id>`), so they compare directly.
 */
export interface GramDialogFilter {
  /** Which folder kind this entry is. */
  type: GramDialogFilterType;
  /** Telegram's folder id (`0` for the `default` "All Chats" entry). */
  id: number;
  /** Folder title as plain text (empty for the `default` entry). */
  title: string;
  /** Emoji chosen as the folder's icon, when set. */
  emoticon?: string;
  /** Include all contacts. */
  contacts: boolean;
  /** Include all non-contact users. */
  nonContacts: boolean;
  /** Include all groups (basic groups and supergroups). */
  groups: boolean;
  /** Include all broadcast channels. */
  broadcasts: boolean;
  /** Include all bots. */
  bots: boolean;
  /** Drop category-matched dialogs that are muted. */
  excludeMuted: boolean;
  /** Drop category-matched dialogs with nothing unread. */
  excludeRead: boolean;
  /** Drop category-matched dialogs that are archived. */
  excludeArchived: boolean;
  /** Peers pinned to the top of this folder (marked ids, in pin order). */
  pinnedPeerIds: string[];
  /** Peers explicitly added to this folder (marked ids). */
  includePeerIds: string[];
  /** Peers explicitly removed from this folder (marked ids). */
  excludePeerIds: string[];
}

/**
 * Parameters for fetching messages from a peer.
 *
 * Two paging styles are supported and should not be mixed:
 *
 * - **Bounded** — `minId` / `maxId` return messages strictly inside the id
 *   bounds, newest-first (the classic "older than X" page).
 * - **Positioned window** — `offsetId` (+ `addOffset`) anchors the page at a
 *   message id and shifts the window: `addOffset: 0` returns the `limit`
 *   messages **older** than the anchor; a **negative** `addOffset` slides the
 *   window toward **newer** messages (e.g. `offsetId: X, addOffset:
 *   -(limit / 2 + 1), limit` yields a window centered on `X`).
 *
 * GramJS sharp edges (do not fight these — shape the request around them):
 * - `maxId` is folded into `offsetId` via `Math.max(offsetId, maxId)`; passing
 *   both is redundant at best.
 * - Combining `offsetId` with `minId` returns an **empty result** whenever
 *   `offsetId - minId <= 1` (an internal early-exit guard). Never pair them —
 *   derive exclusivity from the `addOffset` math instead.
 */
export interface GramGetMessagesParams {
  /** Maximum number of messages to return. */
  limit?: number;
  /** Only return messages with an id greater than this (for pagination). */
  minId?: number;
  /** Only return messages with an id less than this (for pagination). */
  maxId?: number;
  /**
   * Anchor message id for a positioned window (exclusive; pairs with
   * {@link GramGetMessagesParams.addOffset}). See the interface docs for the
   * window math and the GramJS `minId` interaction trap.
   */
  offsetId?: number;
  /**
   * Window shift relative to the anchor's position; `0` = the messages just
   * older than `offsetId`, negative values include newer messages.
   * Meaningless without {@link GramGetMessagesParams.offsetId}.
   */
  addOffset?: number;
}

/** Parameters for marking a dialog as read. */
export interface GramMarkAsReadParams {
  /**
   * Mark read only up to (and including) this message id. Omitted = mark the
   * entire dialog read up to its latest message.
   */
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
