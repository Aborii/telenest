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
