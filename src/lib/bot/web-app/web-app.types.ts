/**
 * @file src/lib/bot/web-app/web-app.types.ts
 *
 * PURPOSE
 * -------
 * Typed shapes for Telegram **Mini App (Web App)** `initData`: the parsed,
 * validated payload returned by
 * {@link import('./validate-web-app-init-data').validateWebAppInitData}, plus the
 * `user`/`chat` sub-objects and the validation options.
 *
 * USAGE
 * -----
 * ```ts
 * const data: WebAppInitData | null = validateWebAppInitData(initData, token);
 * if (data?.user) console.log(data.user.id);
 * ```
 *
 * KEY EXPORTS
 * -----------
 * - WebAppUser: the authenticated Mini App user.
 * - WebAppChat / WEB_APP_CHAT_TYPES: a chat the Mini App was opened from.
 * - WebAppInitData: the full parsed payload.
 * - ValidateWebAppInitDataOptions: options for the validator.
 */

/**
 * A Telegram user as described by Mini App `initData` (`user`/`receiver`). Field
 * names are camelCased from Telegram's snake_case JSON.
 */
export interface WebAppUser {
  /** Unique identifier for the user or bot. */
  id: number;
  /** `true` if this user is a bot (only in the `receiver` field). */
  isBot?: boolean;
  /** First name. */
  firstName: string;
  /** Last name, if set. */
  lastName?: string;
  /** Username, if set. */
  username?: string;
  /** IETF language tag of the user's Telegram client, if known. */
  languageCode?: string;
  /** `true` if the user is a Telegram Premium subscriber. */
  isPremium?: boolean;
  /** `true` if the user added the bot to the attachment menu. */
  addedToAttachmentMenu?: boolean;
  /** `true` if the user allowed the bot to message them. */
  allowsWriteToPm?: boolean;
  /** URL of the user's profile photo, if shared. */
  photoUrl?: string;
}

/**
 * The closed set of chat types reported inside the `chat` object (modelled as an
 * `as const` record, never a TS `enum`, per repo conventions).
 */
export const WEB_APP_CHAT_TYPES = {
  /** A basic group. */
  GROUP: 'group',
  /** A supergroup. */
  SUPERGROUP: 'supergroup',
  /** A channel. */
  CHANNEL: 'channel',
} as const;

/** A chat type from {@link WEB_APP_CHAT_TYPES}. */
export type WebAppChatType =
  (typeof WEB_APP_CHAT_TYPES)[keyof typeof WEB_APP_CHAT_TYPES];

/** Readonly array form of {@link WEB_APP_CHAT_TYPES} for validation. */
export const WEB_APP_CHAT_TYPE_VALUES = Object.values(
  WEB_APP_CHAT_TYPES,
) as readonly WebAppChatType[];

/**
 * A chat the Mini App was opened from (present for attachment-menu / direct-link
 * Mini Apps launched in a group, supergroup, or channel).
 */
export interface WebAppChat {
  /** Unique identifier for the chat. */
  id: number;
  /** The chat's type. */
  type: WebAppChatType;
  /** The chat's title. */
  title: string;
  /** The chat's username, if it is public. */
  username?: string;
  /** URL of the chat's photo, if shared. */
  photoUrl?: string;
}

/**
 * The validated, parsed Mini App `initData`. Returned only when the HMAC
 * signature checks out; never trust these fields without that validation.
 */
export interface WebAppInitData {
  /** The user who launched the Mini App. */
  user?: WebAppUser;
  /** The chat partner in an attachment-menu Mini App opened from a 1-to-1 chat. */
  receiver?: WebAppUser;
  /** The chat the Mini App was opened from (group/supergroup/channel). */
  chat?: WebAppChat;
  /**
   * The type of chat the Mini App was opened from — one of `sender`, `private`,
   * `group`, `supergroup`, or `channel`. Left as a raw string because it carries
   * more values than {@link WebAppChatType}.
   */
  chatType?: string;
  /** Global identifier of the chat the Mini App was launched from. */
  chatInstance?: string;
  /** Unique query identifier, present when launched from an inline keyboard. */
  queryId?: string;
  /** The `start_param` from a `t.me` deep link, if any. */
  startParam?: string;
  /** Seconds after which a message can be sent via `answerWebAppQuery`. */
  canSendAfter?: number;
  /** When Telegram signed the data — derived from `auth_date`. */
  authDate: Date;
  /** The verified HMAC-SHA256 hash that was checked. */
  hash: string;
  /** Telegram's Ed25519 signature for third-party validation, if present. */
  signature?: string;
  /** Every raw `key=value` field as received, for forward compatibility. */
  raw: Readonly<Record<string, string>>;
}

/** Options controlling {@link import('./validate-web-app-init-data').validateWebAppInitData}. */
export interface ValidateWebAppInitDataOptions {
  /**
   * Maximum accepted age of the data, in seconds, checked against `auth_date`.
   * When the data is older, validation returns `null` (treated as expired).
   * Omit to skip the freshness check.
   */
  maxAgeSeconds?: number;
}
