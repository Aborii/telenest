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
import { NewMessage, Raw, type NewMessageEvent } from 'telegram/events';
import {
  DeletedMessage,
  type DeletedMessageEvent,
} from 'telegram/events/DeletedMessage';
import {
  EditedMessage,
  type EditedMessageEvent,
} from 'telegram/events/EditedMessage';
import type { Dialog } from 'telegram/tl/custom/dialog';

import {
  TELEGRAM_AUTH_LOSS_RPC_CODES,
  TelegramAuthError,
  TelegramClientError,
  type TelegramAuthErrorCode,
} from '../common';
import type { IGramClient } from './gram-client.interface';
import {
  GRAM_CHAT_ACTIONS,
  GRAM_DIALOG_FILTER_TYPES,
  GRAM_DIALOG_TYPES,
  GRAM_MEDIA_KINDS,
  GRAM_MESSAGE_ENTITY_TYPES,
  GRAM_MESSAGE_REACTION_KINDS,
  GRAM_SEARCH_FILTERS,
  GRAM_SIGN_IN_STATUSES,
  GRAM_TOP_PEER_TYPES,
  type GramAcceptedLoginSession,
  type GramChatAction,
  type GramChatActionEvent,
  type GramChatInfo,
  type GramContactsSearchResult,
  type GramDeletedMessages,
  type GramDeleteMessagesParams,
  type GramDialog,
  type GramDialogDraft,
  type GramDialogFilter,
  type GramDialogRef,
  type GramDialogType,
  type GramGetDialogsParams,
  type GramGetMessagesParams,
  type GramGetParticipantsParams,
  type GramGetTopPeersParams,
  type GramMarkAsReadParams,
  type GramMediaInfo,
  type GramMediaKind,
  type GramMediaRange,
  type GramMessage,
  type GramMessageEntity,
  type GramMessageForward,
  type GramMessageReaction,
  type GramPeer,
  type GramPinMessageParams,
  type GramQrSignInCallbacks,
  type GramQrToken,
  type GramSearchFilter,
  type GramSearchGlobalParams,
  type GramSearchMessagesParams,
  type GramSendCodeResult,
  type GramSendFileParams,
  type GramSendMessageParams,
  type GramSignInResult,
  type GramSignInWithCodeInput,
  type GramStreamMediaOptions,
  type GramTopPeer,
  type GramTopPeerType,
  type GramUpdateTwoFactorInput,
  type GramUser,
} from './gram-client.types';
import type { TelegramClientModuleOptions } from './telegram-client.options';

// ── big-integer uses `export =` (CommonJS); the project omits esModuleInterop,
//    so the import-equals form is required. GramJS' download offset is a
//    big-integer `BigInteger`, not a native `bigint`. ────────────────────────
// eslint-disable-next-line @typescript-eslint/no-require-imports -- see note above.
import bigInt = require('big-integer');

/**
 * Per-request download size for streaming, in bytes. Must be a multiple of
 * 4096 and at most GramJS' 512 KiB cap; 512 KiB minimizes the number of MTProto
 * round-trips per streamed range.
 */
const STREAM_REQUEST_SIZE = 512 * 1024;

/**
 * Telegram's `upload.getFile` offset must be a multiple of this. We align the
 * requested offset down to it and slice the surplus off the first chunk, which
 * is valid for both of GramJS' direct and generic download iterators.
 */
const MEDIA_OFFSET_ALIGN = 4096;

/**
 * Page size {@link GramjsClientAdapter.searchGlobal} asks for when the caller
 * names none. Unlike a per-chat search, a global one is not bounded by a
 * conversation, and GramJS reads "no limit" as *every* match in the account's
 * entire history — so a default is a guard rail, not a preference. 50 is a
 * screenful and change, which is what the official clients request.
 */
const GLOBAL_SEARCH_DEFAULT_LIMIT = 50;

/**
 * Peers per half {@link GramjsClientAdapter.searchContacts} asks for when the
 * caller names none. `contacts.search` requires the field, so something has to
 * be sent; 20 matches what the official clients ask for a search-as-you-type.
 */
const CONTACTS_SEARCH_DEFAULT_LIMIT = 20;

/**
 * Rated peers {@link GramjsClientAdapter.getTopPeers} asks for when the caller
 * names none. `contacts.getTopPeers` requires the field; 30 is what the
 * official clients request before trimming the strip locally.
 */
const TOP_PEERS_DEFAULT_LIMIT = 30;

/**
 * Builds the `inputMessagesFilter*` instance for each {@link GramSearchFilter}.
 *
 * A `Record` keyed by the union rather than a `switch`, so adding a filter to
 * {@link GRAM_SEARCH_FILTERS} without mapping it here is a compile error.
 * Values are factories because every TL filter is a fresh instance.
 */
const SEARCH_FILTER_FACTORIES: Record<
  GramSearchFilter,
  () => Api.TypeMessagesFilter
> = {
  [GRAM_SEARCH_FILTERS.PHOTOS]: () => new Api.InputMessagesFilterPhotos(),
  [GRAM_SEARCH_FILTERS.VIDEOS]: () => new Api.InputMessagesFilterVideo(),
  [GRAM_SEARCH_FILTERS.PHOTO_VIDEO]: () =>
    new Api.InputMessagesFilterPhotoVideo(),
  [GRAM_SEARCH_FILTERS.DOCUMENTS]: () => new Api.InputMessagesFilterDocument(),
  [GRAM_SEARCH_FILTERS.LINKS]: () => new Api.InputMessagesFilterUrl(),
  [GRAM_SEARCH_FILTERS.MUSIC]: () => new Api.InputMessagesFilterMusic(),
  [GRAM_SEARCH_FILTERS.VOICE]: () => new Api.InputMessagesFilterVoice(),
  [GRAM_SEARCH_FILTERS.GIFS]: () => new Api.InputMessagesFilterGif(),
  [GRAM_SEARCH_FILTERS.PINNED]: () => new Api.InputMessagesFilterPinned(),
};

/**
 * The boolean flags `contacts.getTopPeers` accepts, one per rating list. Only
 * the requested one is set; the rest are left off so Telegram returns a single
 * category.
 */
interface TopPeerRequestFlags {
  /** People the account messages most. */
  correspondents?: boolean;
  /** Bots the account chats with privately. */
  botsPm?: boolean;
  /** Bots the account uses through inline queries. */
  botsInline?: boolean;
  /** Groups the account is most active in. */
  groups?: boolean;
  /** Channels the account reads most. */
  channels?: boolean;
  /** People the account calls most. */
  phoneCalls?: boolean;
  /** People the account forwards messages to most. */
  forwardUsers?: boolean;
  /** Chats the account forwards messages to most. */
  forwardChats?: boolean;
}

/**
 * Maps each {@link GramTopPeerType} to the request flag that selects it.
 * A `Record` keyed by the union, so a new list must be mapped here to compile.
 */
const TOP_PEER_REQUEST_FLAGS: Record<GramTopPeerType, TopPeerRequestFlags> = {
  [GRAM_TOP_PEER_TYPES.CORRESPONDENTS]: { correspondents: true },
  [GRAM_TOP_PEER_TYPES.BOTS_PM]: { botsPm: true },
  [GRAM_TOP_PEER_TYPES.BOTS_INLINE]: { botsInline: true },
  [GRAM_TOP_PEER_TYPES.GROUPS]: { groups: true },
  [GRAM_TOP_PEER_TYPES.CHANNELS]: { channels: true },
  [GRAM_TOP_PEER_TYPES.PHONE_CALLS]: { phoneCalls: true },
  [GRAM_TOP_PEER_TYPES.FORWARD_USERS]: { forwardUsers: true },
  [GRAM_TOP_PEER_TYPES.FORWARD_CHATS]: { forwardChats: true },
};

/**
 * Builds the `topPeerCategory*` instance for each {@link GramTopPeerType} —
 * used both to pick the right category out of a response and to name one when
 * resetting a rating.
 */
const TOP_PEER_CATEGORY_FACTORIES: Record<
  GramTopPeerType,
  () => Api.TypeTopPeerCategory
> = {
  [GRAM_TOP_PEER_TYPES.CORRESPONDENTS]: () =>
    new Api.TopPeerCategoryCorrespondents(),
  [GRAM_TOP_PEER_TYPES.BOTS_PM]: () => new Api.TopPeerCategoryBotsPM(),
  [GRAM_TOP_PEER_TYPES.BOTS_INLINE]: () => new Api.TopPeerCategoryBotsInline(),
  [GRAM_TOP_PEER_TYPES.GROUPS]: () => new Api.TopPeerCategoryGroups(),
  [GRAM_TOP_PEER_TYPES.CHANNELS]: () => new Api.TopPeerCategoryChannels(),
  [GRAM_TOP_PEER_TYPES.PHONE_CALLS]: () => new Api.TopPeerCategoryPhoneCalls(),
  [GRAM_TOP_PEER_TYPES.FORWARD_USERS]: () =>
    new Api.TopPeerCategoryForwardUsers(),
  [GRAM_TOP_PEER_TYPES.FORWARD_CHATS]: () =>
    new Api.TopPeerCategoryForwardChats(),
};

/**
 * The `users` and `chats` a peer-carrying response ships alongside its bare
 * `Api.Peer*` references, indexed by RAW id so a peer can be turned into a
 * titled DTO without another round trip.
 */
interface PeerEntityIndex {
  /** Resolved users, keyed by their raw (unmarked) id. */
  users: Map<string, Api.User>;
  /** Resolved groups and channels, keyed by their raw (unmarked) id. */
  chats: Map<string, Api.Chat | Api.Channel>;
}

/**
 * Picks a per-request download size for a bounded read of `neededBytes`.
 *
 * Telegram only accepts a `getFile` limit that is a power-of-two divisor of
 * 1 MiB (4096, 8192, …, 512 KiB) — not any 4096 multiple — so this rounds up to
 * the next power of two at least {@link MEDIA_OFFSET_ALIGN}, capped at
 * {@link STREAM_REQUEST_SIZE}. It keeps small ranges (e.g. a player's opening
 * byte probe) from pulling a full 512 KiB chunk.
 *
 * @param neededBytes - Bytes the caller needs from the aligned offset onward.
 * @returns A valid `getFile` request size in bytes.
 * @throws Never.
 */
function streamRequestSize(neededBytes: number): number {
  let size = MEDIA_OFFSET_ALIGN;
  while (size < neededBytes && size < STREAM_REQUEST_SIZE) size *= 2;
  return Math.min(size, STREAM_REQUEST_SIZE);
}

/**
 * Private sentinel the connect-timeout timer rejects with, so the race's catch
 * can distinguish a deadline from a genuine connect failure without matching on
 * a message. Module-private — never surfaced to callers.
 */
const CONNECT_TIMEOUT = Symbol('gramjs-connect-timeout');

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
   * @param connectTimeoutMs - Optional per-attempt {@link connect} deadline; on
   *   expiry the underlying client is disconnected and `connect` rejects.
   */
  public constructor(
    private readonly client: TelegramClient,
    private readonly stringSession: sessions.StringSession,
    private readonly credentials: ApiCredentials,
    private readonly connectTimeoutMs?: number,
  ) {}

  /** {@inheritDoc IGramClient.connect} */
  public async connect(): Promise<void> {
    if (this._connected) return;
    try {
      await this.connectWithOptionalTimeout();
      this._connected = true;
    } catch (error) {
      throw this.toClientError(
        error,
        'Failed to connect to Telegram.',
        'connect',
      );
    }
  }

  /**
   * Runs `client.connect()`, bounded by {@link connectTimeoutMs} when set. On
   * timeout the underlying client is disconnected so the abandoned attempt
   * cannot later resurrect a zombie connection, then a timeout error is thrown
   * (wrapped into a `TelegramClientError` by the caller).
   *
   * @returns Resolves once connected.
   * @throws {Error} On a connect failure, or a timeout when the deadline elapses.
   */
  private async connectWithOptionalTimeout(): Promise<void> {
    if (!this.connectTimeoutMs || this.connectTimeoutMs <= 0) {
      await this.client.connect();
      return;
    }

    const timeoutMs = this.connectTimeoutMs;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const timeout = new Promise<never>((_, reject) => {
      timer = setTimeout(() => reject(CONNECT_TIMEOUT), timeoutMs);
      // Never keep the process alive solely for this timer.
      (timer as { unref?: () => void }).unref?.();
    });

    try {
      await Promise.race([this.client.connect(), timeout]);
    } catch (error) {
      if (error === CONNECT_TIMEOUT) {
        // ── Abort the still-pending attempt so it cannot flip `connected` true
        //    after we have already given up. ────────────────────────────────
        await this.client.disconnect().catch(() => undefined);
        throw new Error(`Telegram connect timed out after ${timeoutMs}ms.`);
      }
      throw error;
    } finally {
      if (timer) clearTimeout(timer);
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
      throw this.toClientError(
        error,
        'Failed to check authorization state.',
        'isAuthorized',
      );
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

  /** {@inheritDoc IGramClient.signInWithQrCode} */
  public async signInWithQrCode(
    callbacks: GramQrSignInCallbacks,
  ): Promise<GramUser> {
    // ── GramJS' QR flow drives 2FA through a retrying password loop whose only
    //    way to stop is `onError` returning `true`; left to loop, a wrong
    //    password would re-prompt forever. We stop on the first error and
    //    capture it so the *real* failure (not GramJS' generic "AUTH_USER_CANCEL"
    //    cancellation) is what gets mapped below. ────────────────────────────
    let capturedError: unknown;
    try {
      const user = await this.client.signInUserWithQrCode(this.credentials, {
        qrCode: async (qr) => {
          callbacks.onToken(this.mapQrToken(qr.token, qr.expires));
        },
        password: callbacks.onPassword,
        // ── Returning `true` stops GramJS' retry loop; `async` satisfies the
        //    callback's `Promise<boolean> | void` signature. ─────────────────
        onError: async (error) => {
          capturedError = error;
          return true;
        },
      });
      return this.mapUser(user);
    } catch (error) {
      // ── No `onPassword` on a 2FA account: GramJS throws this English message
      //    directly (never via `onError`); surface it as PASSWORD_REQUIRED. ───
      if (
        capturedError === undefined &&
        this.readErrorMessage(error) === 'Account has 2FA enabled.'
      )
        throw new TelegramAuthError(
          'PASSWORD_REQUIRED',
          'The scanned account has 2FA enabled; provide an onPassword callback.',
          { cause: error },
        );
      throw this.toAuthError(capturedError ?? error);
    }
  }

  /** {@inheritDoc IGramClient.signInAsBot} */
  public async signInAsBot(botToken: string): Promise<GramUser> {
    try {
      const user = await this.client.signInBot(this.credentials, {
        botAuthToken: botToken,
      });
      return this.mapUser(user);
    } catch (error) {
      throw this.toAuthError(error);
    }
  }

  /** {@inheritDoc IGramClient.acceptLoginToken} */
  public async acceptLoginToken(
    token: string,
  ): Promise<GramAcceptedLoginSession> {
    try {
      // ── The web client exports the token base64url-encoded; MTProto expects
      //    the raw bytes. `auth.acceptLoginToken` returns an `Api.Authorization`
      //    (the session-descriptor variant, not `auth.Authorization`), whose
      //    display fields we surface — never the token or any credential. ──────
      const authorization = await this.client.invoke(
        new Api.auth.AcceptLoginToken({
          token: Buffer.from(token, 'base64url'),
        }),
      );
      return this.mapAcceptedLoginSession(authorization);
    } catch (error) {
      throw this.toAcceptLoginTokenError(error);
    }
  }

  /** {@inheritDoc IGramClient.updateTwoFactor} */
  public async updateTwoFactor(input: GramUpdateTwoFactorInput): Promise<void> {
    try {
      await this.client.updateTwoFaSettings({
        currentPassword: input.currentPassword,
        newPassword: input.newPassword,
        hint: input.hint,
      });
    } catch (error) {
      throw this.toAuthError(error);
    }
  }

  /** {@inheritDoc IGramClient.logOut} */
  public async logOut(): Promise<void> {
    try {
      await this.client.invoke(new Api.auth.LogOut());
    } catch (error) {
      throw this.toClientError(error, 'Failed to log out.', 'logOut');
    }
  }

  /** {@inheritDoc IGramClient.getMe} */
  public async getMe(): Promise<GramUser> {
    try {
      const me = await this.client.getMe();
      return this.mapUser(me);
    } catch (error) {
      throw this.toClientError(
        error,
        'Failed to fetch own account info.',
        'getMe',
      );
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
      throw this.toClientError(error, 'Failed to list dialogs.', 'getDialogs');
    }
  }

  /** {@inheritDoc IGramClient.getDialogFilters} */
  public async getDialogFilters(): Promise<GramDialogFilter[]> {
    try {
      const result = await this.client.invoke(
        new Api.messages.GetDialogFilters(),
      );
      // ── A folder can pin/include "Saved Messages" as InputPeerSelf, which
      //    carries no id. Resolve the own account id once, only when some
      //    filter actually references self (getMe() is cached by GramJS). ────
      const needsSelf = result.filters.some(
        (filter) =>
          (filter instanceof Api.DialogFilter ||
            filter instanceof Api.DialogFilterChatlist) &&
          [
            ...filter.pinnedPeers,
            ...filter.includePeers,
            ...(filter instanceof Api.DialogFilter ? filter.excludePeers : []),
          ].some((peer) => peer instanceof Api.InputPeerSelf),
      );
      const selfId = needsSelf
        ? this.mapUser(await this.client.getMe()).id
        : undefined;
      return result.filters.map((filter) =>
        this.mapDialogFilter(filter, selfId),
      );
    } catch (error) {
      throw this.toClientError(
        error,
        'Failed to list dialog filters.',
        'getDialogFilters',
      );
    }
  }

  /** {@inheritDoc IGramClient.getMessages} */
  public async getMessages(
    peer: GramPeer,
    params: GramGetMessagesParams = {},
  ): Promise<GramMessage[]> {
    try {
      // ── Only forward the paging anchors that are actually set. Passing a
      //    key as `undefined` OVERRIDES GramJS's own defaults (maxId/offsetId
      //    default to 0) via the internal Object.assign, and its
      //    `offsetId = Math.max(offsetId, maxId)` then evaluates to NaN
      //    (which serializes as offsetId 0) — silently discarding a positioned
      //    window and returning the newest slice instead. Omit undefined keys
      //    so the library defaults survive. ──────────────────────────────────
      const messages = await this.client.getMessages(peer, {
        limit: params.limit,
        ...(params.minId !== undefined && { minId: params.minId }),
        ...(params.maxId !== undefined && { maxId: params.maxId }),
        ...(params.offsetId !== undefined && { offsetId: params.offsetId }),
        ...(params.addOffset !== undefined && { addOffset: params.addOffset }),
      });
      return messages.map((message) => this.mapMessage(message));
    } catch (error) {
      throw this.toClientError(
        error,
        'Failed to fetch messages.',
        'getMessages',
      );
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
      return this.mapMessage(this.requireMessage(message, 'sendMessage'));
    } catch (error) {
      // ── Surface the precise "no message" error instead of re-wrapping it. ────
      if (error instanceof TelegramClientError) throw error;
      throw this.toClientError(error, 'Failed to send message.', 'sendMessage');
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
      return this.mapMessage(this.requireMessage(message, 'sendFile'));
    } catch (error) {
      // ── Surface the precise "no message" error instead of re-wrapping it. ────
      if (error instanceof TelegramClientError) throw error;
      throw this.toClientError(error, 'Failed to send file.', 'sendFile');
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
      throw this.toClientError(
        error,
        'Failed to download media.',
        'downloadMedia',
      );
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
      throw this.toClientError(
        error,
        'Failed to download profile photo.',
        'downloadProfilePhoto',
      );
    }
  }

  /** {@inheritDoc IGramClient.getMediaInfo} */
  public async getMediaInfo(
    peer: GramPeer,
    messageId: number,
  ): Promise<GramMediaInfo | undefined> {
    try {
      const message = await this.fetchMediaMessage(peer, messageId);
      if (!message) return undefined;
      return this.mapMediaInfo(message.media);
    } catch (error) {
      throw this.toClientError(
        error,
        'Failed to read media info.',
        'getMediaInfo',
      );
    }
  }

  /** {@inheritDoc IGramClient.downloadMediaRange} */
  public async downloadMediaRange(
    peer: GramPeer,
    messageId: number,
    range: GramMediaRange,
  ): Promise<Buffer | undefined> {
    // ── Validate up front: a negative offset corrupts the alignment math (and
    //    these power HTTP Range serving, where a malformed header can reach us). ─
    this.assertNonNegativeInt(range.offset, 'offset', 'downloadMediaRange');
    this.assertNonNegativeInt(range.limit, 'limit', 'downloadMediaRange');
    try {
      const message = await this.fetchMediaMessage(peer, messageId);
      if (!message) return undefined;

      // ── Align down to a valid Telegram offset, then slice the surplus. ─────
      const skip = range.offset % MEDIA_OFFSET_ALIGN;
      const alignedOffset = range.offset - skip;
      const needed = skip + range.limit;

      const buffers: Buffer[] = [];
      let collected = 0;
      for await (const chunk of this.client.iterDownload({
        file: message.media,
        offset: bigInt(alignedOffset),
        // ── Size the request to the range so small probes don't pull 512 KiB. ─
        requestSize: streamRequestSize(needed),
      })) {
        buffers.push(chunk);
        collected += chunk.length;
        if (collected >= needed) break;
      }

      return Buffer.concat(buffers).subarray(skip, skip + range.limit);
    } catch (error) {
      throw this.toClientError(
        error,
        'Failed to download media range.',
        'downloadMediaRange',
      );
    }
  }

  /** {@inheritDoc IGramClient.streamMedia} */
  public async streamMedia(
    peer: GramPeer,
    messageId: number,
    options: GramStreamMediaOptions = {},
  ): Promise<AsyncIterable<Buffer>> {
    let message: Api.Message | undefined;
    try {
      message = await this.fetchMediaMessage(peer, messageId);
    } catch (error) {
      throw this.toClientError(error, 'Failed to stream media.', 'streamMedia');
    }
    if (!message)
      throw new TelegramClientError(
        'Message has no downloadable media to stream.',
        { operation: 'streamMedia' },
      );

    const media = message.media;
    const client = this.client;
    // ── Bound so the lazy generator below (where `this` is undefined) can still
    //    produce flood-aware client errors via the shared mapper. ──────────────
    const toClientError = this.toClientError.bind(this);
    const offset = options.offset ?? 0;
    const limit = options.limit;
    // ── Reject a negative offset/limit before the aligned-slice math runs. ─────
    this.assertNonNegativeInt(offset, 'offset', 'streamMedia');
    if (limit !== undefined)
      this.assertNonNegativeInt(limit, 'limit', 'streamMedia');
    const alignedOffset = offset - (offset % MEDIA_OFFSET_ALIGN);

    // ── Lazy generator: GramJS yields aligned chunks; we trim the leading
    //    surplus (offset % 4096) and stop once `limit` bytes are emitted. ─────
    return (async function* streamChunks(): AsyncGenerator<Buffer> {
      let skip = offset - alignedOffset;
      let remaining = limit;
      try {
        for await (const raw of client.iterDownload({
          file: media,
          offset: bigInt(alignedOffset),
          requestSize: STREAM_REQUEST_SIZE,
        })) {
          let chunk = raw;
          if (skip > 0) {
            if (chunk.length <= skip) {
              skip -= chunk.length;
              continue;
            }
            chunk = chunk.subarray(skip);
            skip = 0;
          }
          if (remaining === undefined) {
            yield chunk;
            continue;
          }
          if (remaining <= 0) return;
          if (chunk.length >= remaining) {
            yield chunk.subarray(0, remaining);
            return;
          }
          yield chunk;
          remaining -= chunk.length;
        }
      } catch (error) {
        throw toClientError(error, 'Failed to stream media.', 'streamMedia');
      }
    })();
  }

  // ── Chats & channels ───────────────────────────────────────────────────────

  /** {@inheritDoc IGramClient.joinChannel} */
  public async joinChannel(peer: GramPeer): Promise<void> {
    try {
      await this.client.invoke(new Api.channels.JoinChannel({ channel: peer }));
    } catch (error) {
      throw this.toClientError(error, 'Failed to join channel.', 'joinChannel');
    }
  }

  /** {@inheritDoc IGramClient.leaveChannel} */
  public async leaveChannel(peer: GramPeer): Promise<void> {
    try {
      await this.client.invoke(
        new Api.channels.LeaveChannel({ channel: peer }),
      );
    } catch (error) {
      throw this.toClientError(
        error,
        'Failed to leave channel.',
        'leaveChannel',
      );
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
      throw this.toClientError(
        error,
        'Failed to list participants.',
        'getParticipants',
      );
    }
  }

  /** {@inheritDoc IGramClient.searchMessages} */
  public async searchMessages(
    peer: GramPeer,
    query: string,
    params: GramSearchMessagesParams = {},
  ): Promise<GramMessage[]> {
    try {
      const filter = this.toInputFilter(params.filter);
      const messages = await this.client.getMessages(peer, {
        search: query,
        limit: params.limit,
        // ── Spread rather than assigned: GramJS merges the caller's object
        //    over its defaults with `Object.assign`, so an explicit
        //    `offsetId: undefined` would REPLACE its `0` default with
        //    `undefined` and poison the offset arithmetic. ──────────────────
        ...(filter ? { filter } : {}),
        ...(params.offsetId === undefined ? {} : { offsetId: params.offsetId }),
      });
      return messages.map((message) => this.mapMessage(message));
    } catch (error) {
      throw this.toClientError(
        error,
        'Failed to search messages.',
        'searchMessages',
      );
    }
  }

  /** {@inheritDoc IGramClient.searchGlobal} */
  public async searchGlobal(
    query: string,
    params: GramSearchGlobalParams = {},
  ): Promise<GramMessage[]> {
    try {
      // ── A message search with NO entity is how GramJS reaches
      //    `messages.searchGlobal`, so this stays ONE request and the peer /
      //    sender entities arrive resolved with it — which a hand-rolled
      //    `invoke` would then have to look up per result. ──────────────────
      const filter = this.toInputFilter(params.filter);
      const messages = await this.client.getMessages(undefined, {
        search: query,
        limit: params.limit ?? GLOBAL_SEARCH_DEFAULT_LIMIT,
        ...(filter ? { filter } : {}),
        ...(params.offsetId === undefined ? {} : { offsetId: params.offsetId }),
      });
      return messages.map((message) => this.mapMessage(message));
    } catch (error) {
      throw this.toClientError(
        error,
        'Failed to search messages globally.',
        'searchGlobal',
      );
    }
  }

  /** {@inheritDoc IGramClient.searchContacts} */
  public async searchContacts(
    query: string,
    limit: number = CONTACTS_SEARCH_DEFAULT_LIMIT,
  ): Promise<GramContactsSearchResult> {
    try {
      const found = await this.client.invoke(
        new Api.contacts.Search({ q: query, limit }),
      );
      const index = this.indexPeerEntities(found.users, found.chats);
      return {
        myResults: this.mapPeerRefs(found.myResults, index),
        globalResults: this.mapPeerRefs(found.results, index),
      };
    } catch (error) {
      throw this.toClientError(
        error,
        'Failed to search contacts.',
        'searchContacts',
      );
    }
  }

  /** {@inheritDoc IGramClient.getTopPeers} */
  public async getTopPeers(
    type: GramTopPeerType,
    params: GramGetTopPeersParams = {},
  ): Promise<GramTopPeer[]> {
    try {
      const result = await this.client.invoke(
        new Api.contacts.GetTopPeers({
          ...TOP_PEER_REQUEST_FLAGS[type],
          offset: 0,
          limit: params.limit ?? TOP_PEERS_DEFAULT_LIMIT,
          // ── `hash: 0` means "I hold nothing, send the list". Honouring the
          //    incremental hash would mean caching the previous answer, which
          //    belongs to the caller, not to a stateless adapter. ───────────
          hash: bigInt.zero,
        }),
      );

      // ── `topPeersDisabled` (the account switched suggestions off in its
      //    privacy settings) and `topPeersNotModified` both mean "nothing to
      //    show". Neither is a failure, and a client should render an empty
      //    strip for either — so both resolve to `[]` rather than throw. ────
      if (!(result instanceof Api.contacts.TopPeers)) return [];

      const index = this.indexPeerEntities(result.users, result.chats);
      const wanted = TOP_PEER_CATEGORY_FACTORIES[type]();
      const category = result.categories.find(
        (entry) => entry.category.CONSTRUCTOR_ID === wanted.CONSTRUCTOR_ID,
      );
      if (!category) return [];

      // ── `flatMap` over `map` so a peer whose entity Telegram did not send
      //    back drops out instead of becoming a blank row. ─────────────────
      return category.peers.flatMap((entry) => {
        const ref = this.mapPeerRef(entry.peer, index);
        if (!ref) return [];
        return [
          {
            id: ref.id,
            type: ref.type,
            title: ref.title,
            username: ref.username,
            rating: entry.rating,
          },
        ];
      });
    } catch (error) {
      throw this.toClientError(
        error,
        'Failed to list top peers.',
        'getTopPeers',
      );
    }
  }

  /** {@inheritDoc IGramClient.resetTopPeerRating} */
  public async resetTopPeerRating(
    type: GramTopPeerType,
    peer: GramPeer,
  ): Promise<void> {
    try {
      await this.client.invoke(
        new Api.contacts.ResetTopPeerRating({
          category: TOP_PEER_CATEGORY_FACTORIES[type](),
          peer,
        }),
      );
    } catch (error) {
      throw this.toClientError(
        error,
        'Failed to reset the top-peer rating.',
        'resetTopPeerRating',
      );
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
      throw this.toClientError(
        error,
        'Failed to fetch chat info.',
        'getFullChat',
      );
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
      return this.mapMessage(this.requireMessage(message, 'editMessage'));
    } catch (error) {
      // ── Surface the precise "no message" error instead of re-wrapping it. ────
      if (error instanceof TelegramClientError) throw error;
      throw this.toClientError(error, 'Failed to edit message.', 'editMessage');
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
      throw this.toClientError(
        error,
        'Failed to delete messages.',
        'deleteMessages',
      );
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
      // ── GramJS types this as Api.Message[], but entries are undefined when one
      //    couldn't be forwarded; drop those rather than mapping a TypeError. ───
      return messages
        .filter((message): message is Api.Message => Boolean(message))
        .map((message) => this.mapMessage(message));
    } catch (error) {
      throw this.toClientError(
        error,
        'Failed to forward messages.',
        'forwardMessages',
      );
    }
  }

  /** {@inheritDoc IGramClient.markAsRead} */
  public async markAsRead(
    peer: GramPeer,
    params: GramMarkAsReadParams = {},
  ): Promise<void> {
    try {
      // ── maxId goes through the POSITIONAL `message` argument on purpose.
      //    GramJS's MarkAsReadParams object has an inverted `clearMentions`
      //    flag: passing any params object with a falsy `clearMentions` fires
      //    an extra `messages.ReadMentions` RPC as a side effect. The
      //    positional form sets maxId without that trap. ─────────────────────
      if (params.maxId !== undefined) {
        await this.client.markAsRead(peer, params.maxId);
      } else {
        await this.client.markAsRead(peer);
      }
    } catch (error) {
      throw this.toClientError(error, 'Failed to mark as read.', 'markAsRead');
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
      throw this.toClientError(error, 'Failed to pin message.', 'pinMessage');
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

  /** {@inheritDoc IGramClient.onEditedMessage} */
  public onEditedMessage(handler: (message: GramMessage) => void): () => void {
    const builder = new EditedMessage({});
    const callback = (event: EditedMessageEvent): void => {
      handler(this.mapMessage(event.message));
    };
    this.client.addEventHandler(callback, builder);
    return () => {
      this.client.removeEventHandler(callback, builder);
    };
  }

  /** {@inheritDoc IGramClient.onDeletedMessages} */
  public onDeletedMessages(
    handler: (event: GramDeletedMessages) => void,
  ): () => void {
    const builder = new DeletedMessage({});
    const callback = (event: DeletedMessageEvent): void => {
      handler(this.mapDeletedMessages(event));
    };
    this.client.addEventHandler(callback, builder);
    return () => {
      this.client.removeEventHandler(callback, builder);
    };
  }

  /** {@inheritDoc IGramClient.onChatAction} */
  public onChatAction(
    handler: (event: GramChatActionEvent) => void,
  ): () => void {
    // ── Chat actions have no dedicated GramJS event builder; they arrive as raw
    //    updates. Filter to just the typing/presence update types so the handler
    //    is not woken for every unrelated update. ─────────────────────────────
    const builder = new Raw({
      types: [
        Api.UpdateUserTyping,
        Api.UpdateChatUserTyping,
        Api.UpdateChannelUserTyping,
        Api.UpdateUserStatus,
      ],
    });
    const callback = (update: Api.TypeUpdate): void => {
      const event = this.mapChatAction(update);
      // ── An update we don't model (e.g. an unrecognized status) maps to
      //    undefined; skip it rather than surface a meaningless event. ─────────
      if (event) handler(event);
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
   * Maps a GramJS QR login token (`{ token, expires }`) into a {@link GramQrToken},
   * base64url-encoding the raw bytes and building the `tg://login` deep link.
   *
   * @param token - The raw login-token bytes from `Api.auth.LoginToken`.
   * @param expires - Unix timestamp (seconds) when the token expires.
   * @returns The normalized QR token DTO.
   * @throws Never.
   */
  private mapQrToken(token: Buffer, expires: number): GramQrToken {
    const encoded = token.toString('base64url');
    return { token: encoded, url: `tg://login?token=${encoded}`, expires };
  }

  /**
   * Maps the MTProto `Authorization` returned by `auth.acceptLoginToken` into a
   * secret-free {@link GramAcceptedLoginSession}. Copies only display metadata
   * about the newly authorized session — never the token or a session string.
   *
   * @param authorization - The `Api.auth.AcceptLoginToken` result. Telegram
   *   returns the session-descriptor `Api.Authorization` (`appName` /
   *   `deviceModel` / `platform` / …), not the user-wrapping `auth.Authorization`.
   * @returns The normalized accepted-session summary DTO.
   * @throws Never.
   */
  private mapAcceptedLoginSession(
    authorization: Api.TypeAuthorization,
  ): GramAcceptedLoginSession {
    return {
      appName: authorization.appName,
      deviceModel: authorization.deviceModel,
      platform: authorization.platform,
      systemVersion: authorization.systemVersion,
      appVersion: authorization.appVersion,
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

    const lastMessage = dialog.message;
    const preview = lastMessage?.message;
    // ── Read positions live on the raw TL dialog (same object the mute state
    //    comes from), not on the GramJS wrapper or the peer entity. ──────────
    const raw = dialog.dialog;
    // ── Bot/contact status lives on the resolved user entity; both are
    //    definitionally false for groups/channels (resolved or not). ─────────
    const entity = dialog.entity;
    const isUserEntity = entity instanceof Api.User;
    const isBot =
      type === GRAM_DIALOG_TYPES.USER
        ? isUserEntity
          ? Boolean(entity.bot)
          : undefined
        : false;
    const isContact =
      type === GRAM_DIALOG_TYPES.USER
        ? isUserEntity
          ? Boolean(entity.contact)
          : undefined
        : false;
    return {
      id: dialog.id ? dialog.id.toString() : '',
      title: dialog.title ?? dialog.name ?? '',
      type,
      unreadCount: dialog.unreadCount,
      pinned: dialog.pinned,
      lastMessagePreview: preview ? preview : undefined,
      lastMessageDate: lastMessage?.date,
      muted: this.isDialogMuted(dialog),
      hasPhoto: this.entityHasPhoto(dialog.entity),
      readInboxMaxId: raw?.readInboxMaxId,
      readOutboxMaxId: raw?.readOutboxMaxId,
      topMessageId: raw?.topMessage,
      lastMessageOut: lastMessage ? Boolean(lastMessage.out) : undefined,
      lastMessageSenderName: this.senderDisplayName(lastMessage?.sender),
      lastMessageMediaKind: this.mapMediaInfo(lastMessage?.media)?.kind,
      isBot,
      isContact,
      unreadMark: raw ? Boolean(raw.unreadMark) : undefined,
      draft: this.mapDraft(raw?.draft),
    };
  }

  /**
   * Maps a dialog's unsent draft into a {@link GramDialogDraft}.
   *
   * `draftMessageEmpty` maps to `undefined` rather than an empty draft:
   * Telegram uses it to say a draft was CLEARED, and a client that took it at
   * face value would leave a permanent "Draft:" row on a dialog whose draft
   * the reader already deleted.
   *
   * @param draft - The raw draft on the TL dialog, if any.
   * @returns The mapped draft, or `undefined` when there is none.
   * @throws Never.
   */
  private mapDraft(
    draft: Api.TypeDraftMessage | undefined,
  ): GramDialogDraft | undefined {
    if (!(draft instanceof Api.DraftMessage)) return undefined;
    const replyTo = draft.replyTo;
    return {
      text: draft.message,
      date: draft.date,
      replyToMsgId:
        replyTo instanceof Api.InputReplyToMessage
          ? replyTo.replyToMsgId
          : undefined,
    };
  }

  /**
   * Maps a TL dialog filter into a {@link GramDialogFilter}.
   *
   * @param filter - The `Api.DialogFilter` / `DialogFilterChatlist` /
   *   `DialogFilterDefault` to map.
   * @param selfId - The own account id (marked format), required only to
   *   resolve `InputPeerSelf` ("Saved Messages") peer entries.
   * @returns The normalized filter DTO.
   * @throws Never.
   */
  private mapDialogFilter(
    filter: Api.TypeDialogFilter,
    selfId?: string,
  ): GramDialogFilter {
    if (filter instanceof Api.DialogFilter) {
      return {
        type: GRAM_DIALOG_FILTER_TYPES.FILTER,
        id: filter.id,
        title: filter.title.text,
        emoticon: filter.emoticon || undefined,
        contacts: Boolean(filter.contacts),
        nonContacts: Boolean(filter.nonContacts),
        groups: Boolean(filter.groups),
        broadcasts: Boolean(filter.broadcasts),
        bots: Boolean(filter.bots),
        excludeMuted: Boolean(filter.excludeMuted),
        excludeRead: Boolean(filter.excludeRead),
        excludeArchived: Boolean(filter.excludeArchived),
        pinnedPeerIds: this.mapInputPeerIds(filter.pinnedPeers, selfId),
        includePeerIds: this.mapInputPeerIds(filter.includePeers, selfId),
        excludePeerIds: this.mapInputPeerIds(filter.excludePeers, selfId),
      };
    }
    if (filter instanceof Api.DialogFilterChatlist) {
      return {
        type: GRAM_DIALOG_FILTER_TYPES.CHATLIST,
        id: filter.id,
        title: filter.title.text,
        emoticon: filter.emoticon || undefined,
        contacts: false,
        nonContacts: false,
        groups: false,
        broadcasts: false,
        bots: false,
        excludeMuted: false,
        excludeRead: false,
        excludeArchived: false,
        pinnedPeerIds: this.mapInputPeerIds(filter.pinnedPeers, selfId),
        includePeerIds: this.mapInputPeerIds(filter.includePeers, selfId),
        excludePeerIds: [],
      };
    }
    // ── Api.DialogFilterDefault: a positional marker for "All Chats". ────────
    return {
      type: GRAM_DIALOG_FILTER_TYPES.DEFAULT,
      id: 0,
      title: '',
      contacts: false,
      nonContacts: false,
      groups: false,
      broadcasts: false,
      bots: false,
      excludeMuted: false,
      excludeRead: false,
      excludeArchived: false,
      pinnedPeerIds: [],
      includePeerIds: [],
      excludePeerIds: [],
    };
  }

  /**
   * Maps TL `InputPeer`s from a dialog filter into GramJS *marked* id strings
   * (users unmarked, basic chats `-<id>`, channels `-100<id>` — the same
   * format {@link mapDialog} emits for {@link GramDialog.id}, so consumers can
   * compare them directly). Unresolvable entries (`InputPeerEmpty`, the
   * `*FromMessage` variants, or `InputPeerSelf` without a `selfId`) are
   * dropped rather than emitted as garbage.
   *
   * @param peers - The filter's TL peer list.
   * @param selfId - The own account id, to resolve `InputPeerSelf`.
   * @returns Marked peer id strings, order preserved.
   * @throws Never.
   */
  private mapInputPeerIds(
    peers: Api.TypeInputPeer[],
    selfId?: string,
  ): string[] {
    const ids: string[] = [];
    for (const peer of peers) {
      if (peer instanceof Api.InputPeerUser) ids.push(peer.userId.toString());
      else if (peer instanceof Api.InputPeerChat)
        ids.push(`-${peer.chatId.toString()}`);
      // ── "-100" is a string concat, matching GramJS' own getPeerId marking
      //    (NOT a numeric 1e12 offset — those differ for short channel ids). ──
      else if (peer instanceof Api.InputPeerChannel)
        ids.push(`-100${peer.channelId.toString()}`);
      else if (peer instanceof Api.InputPeerSelf && selfId !== undefined)
        ids.push(selfId);
    }
    return ids;
  }

  /**
   * Reports whether the account has muted notifications for a dialog.
   *
   * Telegram stores the mute state as a `muteUntil` timestamp on the raw
   * {@link Api.Dialog}'s notification settings (NOT on the peer entity): the
   * dialog is muted while that timestamp is in the future. Returns `undefined`
   * when the object carries no settings (e.g. a hand-built fake), so the field
   * is simply omitted rather than reported as `false`.
   *
   * @param dialog - The GramJS dialog to inspect.
   * @returns `true`/`false` when settings are present, else `undefined`.
   * @throws Never.
   */
  private isDialogMuted(dialog: Dialog): boolean | undefined {
    const settings = dialog.dialog?.notifySettings;
    if (!settings) return undefined;
    const muteUntil = settings.muteUntil;
    if (muteUntil === undefined) return false;
    return muteUntil > Math.floor(Date.now() / 1000);
  }

  /**
   * Reports whether a resolved peer entity carries a non-empty profile/chat
   * photo — a cheap hint that an avatar is fetchable, without downloading it.
   *
   * @param entity - The dialog's resolved entity, if any.
   * @returns `true`/`false` when the entity is resolved, else `undefined`.
   * @throws Never.
   */
  private entityHasPhoto(entity: Dialog['entity']): boolean | undefined {
    if (!entity) return undefined;
    const photo = 'photo' in entity ? entity.photo : undefined;
    return (
      photo instanceof Api.UserProfilePhoto || photo instanceof Api.ChatPhoto
    );
  }

  /**
   * Ensures a GramJS call that should return a message actually did. GramJS types
   * `sendMessage`/`editMessage`/… as `Promise<Api.Message>`, but at runtime the
   * underlying `_getResponseMessage` returns `undefined` when the RPC result is
   * not an update shape it recognises. Mapping that would throw an opaque
   * `TypeError`; this converts the absence into a precise {@link TelegramClientError}.
   *
   * @param message - The (possibly-undefined) message GramJS returned.
   * @param operation - The operation name, used in the error.
   * @returns The message, guaranteed non-nullish.
   * @throws {TelegramClientError} When `message` is nullish.
   */
  private requireMessage(
    message: Api.Message | undefined,
    operation: string,
  ): Api.Message {
    if (!message)
      throw new TelegramClientError(
        `Telegram returned no message for ${operation}.`,
        { operation },
      );
    return message;
  }

  /**
   * Asserts a media offset/limit is a non-negative integer. A negative value
   * breaks the offset-alignment math (producing wrong slices), and these inputs
   * power HTTP Range serving where a malformed `Range` header could reach them.
   *
   * @param value - The candidate offset or limit.
   * @param name - The field name (`offset`/`limit`), for the error message.
   * @param operation - The calling operation, for the error.
   * @returns Nothing.
   * @throws {TelegramClientError} When `value` is not a non-negative integer.
   */
  private assertNonNegativeInt(
    value: number,
    name: string,
    operation: string,
  ): void {
    if (!Number.isInteger(value) || value < 0)
      throw new TelegramClientError(
        `${operation}: "${name}" must be a non-negative integer (got ${value}).`,
        { operation },
      );
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
    const editDate = message.editDate;
    return {
      id: message.id,
      peerId: this.peerToString(message.peerId),
      text: message.message ?? '',
      date: message.date,
      out: Boolean(message.out),
      senderId: sender ? sender.toString() : undefined,
      hasMedia: this.hasDownloadableMedia(message),
      replyToMsgId: this.replyToMsgId(message),
      edited: editDate !== undefined ? true : undefined,
      editDate,
      media: this.mapMediaInfo(message.media),
      senderName: this.senderDisplayName(message.sender),
      // ── Album ids are random 64-bit values — stringify, never Number(). ───
      groupedId: message.groupedId?.toString(),
      entities: this.mapEntities(message.entities),
      reactions: this.mapReactions(message.reactions),
      forward: this.mapForward(message.fwdFrom),
      viaBotUsername: this.viaBotUsername(message),
      postAuthor: message.postAuthor ?? undefined,
    };
  }

  /**
   * Maps a message's formatting spans into {@link GramMessageEntity}s.
   *
   * Offsets pass through untouched — they are UTF-16 code units on both sides,
   * which is exactly what a JavaScript consumer needs to slice the text.
   *
   * An entity kind this version does not model still maps through, as
   * `unknown` with its offsets intact: a renderer can then leave that span
   * alone, whereas dropping the entry would shift nothing but silently lose a
   * span the text still contains.
   *
   * @param entities - The raw entities on the message, if any.
   * @returns The mapped spans, or `undefined` when the message has none.
   * @throws Never.
   */
  private mapEntities(
    entities: Api.TypeMessageEntity[] | undefined,
  ): GramMessageEntity[] | undefined {
    if (!entities?.length) return undefined;
    return entities.map((entity) => {
      const base = { offset: entity.offset, length: entity.length };
      if (entity instanceof Api.MessageEntityBold)
        return { ...base, type: GRAM_MESSAGE_ENTITY_TYPES.BOLD };
      if (entity instanceof Api.MessageEntityItalic)
        return { ...base, type: GRAM_MESSAGE_ENTITY_TYPES.ITALIC };
      if (entity instanceof Api.MessageEntityUnderline)
        return { ...base, type: GRAM_MESSAGE_ENTITY_TYPES.UNDERLINE };
      if (entity instanceof Api.MessageEntityStrike)
        return { ...base, type: GRAM_MESSAGE_ENTITY_TYPES.STRIKETHROUGH };
      if (entity instanceof Api.MessageEntityCode)
        return { ...base, type: GRAM_MESSAGE_ENTITY_TYPES.CODE };
      if (entity instanceof Api.MessageEntityPre)
        return {
          ...base,
          type: GRAM_MESSAGE_ENTITY_TYPES.PRE,
          // Telegram sends an empty string when no language was given.
          language: entity.language || undefined,
        };
      if (entity instanceof Api.MessageEntitySpoiler)
        return { ...base, type: GRAM_MESSAGE_ENTITY_TYPES.SPOILER };
      if (entity instanceof Api.MessageEntityBlockquote)
        return {
          ...base,
          type: GRAM_MESSAGE_ENTITY_TYPES.BLOCKQUOTE,
          collapsed: entity.collapsed ? true : undefined,
        };
      if (entity instanceof Api.MessageEntityUrl)
        return { ...base, type: GRAM_MESSAGE_ENTITY_TYPES.URL };
      if (entity instanceof Api.MessageEntityTextUrl)
        return {
          ...base,
          type: GRAM_MESSAGE_ENTITY_TYPES.TEXT_URL,
          url: entity.url,
        };
      if (entity instanceof Api.MessageEntityEmail)
        return { ...base, type: GRAM_MESSAGE_ENTITY_TYPES.EMAIL };
      if (entity instanceof Api.MessageEntityPhone)
        return { ...base, type: GRAM_MESSAGE_ENTITY_TYPES.PHONE };
      if (entity instanceof Api.MessageEntityMention)
        return { ...base, type: GRAM_MESSAGE_ENTITY_TYPES.MENTION };
      if (entity instanceof Api.MessageEntityMentionName)
        return {
          ...base,
          type: GRAM_MESSAGE_ENTITY_TYPES.MENTION_NAME,
          userId: entity.userId.toString(),
        };
      if (entity instanceof Api.MessageEntityHashtag)
        return { ...base, type: GRAM_MESSAGE_ENTITY_TYPES.HASHTAG };
      if (entity instanceof Api.MessageEntityCashtag)
        return { ...base, type: GRAM_MESSAGE_ENTITY_TYPES.CASHTAG };
      if (entity instanceof Api.MessageEntityBotCommand)
        return { ...base, type: GRAM_MESSAGE_ENTITY_TYPES.BOT_COMMAND };
      if (entity instanceof Api.MessageEntityCustomEmoji)
        return {
          ...base,
          type: GRAM_MESSAGE_ENTITY_TYPES.CUSTOM_EMOJI,
          // 64-bit document id — stringify, never Number().
          documentId: entity.documentId.toString(),
        };
      if (entity instanceof Api.MessageEntityBankCard)
        return { ...base, type: GRAM_MESSAGE_ENTITY_TYPES.BANK_CARD };
      return { ...base, type: GRAM_MESSAGE_ENTITY_TYPES.UNKNOWN };
    });
  }

  /**
   * Maps a message's aggregated reactions into {@link GramMessageReaction}s.
   *
   * `chosen` tests whether `chosenOrder` is PRESENT rather than truthy: the
   * order is zero-based, so the account's first reaction carries `0`, and a
   * truthiness test would report that one as not chosen.
   *
   * @param reactions - The raw reactions block on the message, if any.
   * @returns The mapped chips, or `undefined` when the message has none.
   * @throws Never.
   */
  private mapReactions(
    reactions: Api.MessageReactions | undefined,
  ): GramMessageReaction[] | undefined {
    const results = reactions?.results;
    if (!results?.length) return undefined;
    return results.map((result) => {
      const chosen = result.chosenOrder !== undefined;
      const reaction = result.reaction;
      if (reaction instanceof Api.ReactionEmoji)
        return {
          kind: GRAM_MESSAGE_REACTION_KINDS.EMOJI,
          emoticon: reaction.emoticon,
          count: result.count,
          chosen,
        };
      if (reaction instanceof Api.ReactionCustomEmoji)
        return {
          kind: GRAM_MESSAGE_REACTION_KINDS.CUSTOM_EMOJI,
          // 64-bit document id — stringify, never Number().
          documentId: reaction.documentId.toString(),
          count: result.count,
          chosen,
        };
      return {
        kind: GRAM_MESSAGE_REACTION_KINDS.PAID,
        count: result.count,
        chosen,
      };
    });
  }

  /**
   * Maps a forward header into a {@link GramMessageForward}.
   *
   * A header with NEITHER an id nor a name still maps through: Telegram sends
   * exactly that when the original sender is fully hidden, and dropping it
   * would render the message as the forwarder's own words.
   *
   * @param fwdFrom - The raw forward header, when the message is a forward.
   * @returns The mapped provenance, or `undefined` for an original message.
   * @throws Never.
   */
  private mapForward(
    fwdFrom: Api.TypeMessageFwdHeader | undefined,
  ): GramMessageForward | undefined {
    if (!(fwdFrom instanceof Api.MessageFwdHeader)) return undefined;
    return {
      fromId: fwdFrom.fromId ? this.markedPeerId(fwdFrom.fromId) : undefined,
      fromName: fwdFrom.fromName,
      date: fwdFrom.date,
      channelPost: fwdFrom.channelPost,
      postAuthor: fwdFrom.postAuthor,
    };
  }

  /**
   * Renders a peer as its MARKED decimal id — a channel as `-100<id>`, a small
   * group as `-<id>`, a user as its plain id.
   *
   * Deliberately not {@link GramjsClientAdapter.peerToString}, which returns
   * the RAW id: these two forms both exist in the DTOs already
   * ({@link GramMessage.peerId} is raw, {@link GramMessage.senderId} is marked,
   * because GramJS marks it), and the difference is not cosmetic. A forward's
   * origin is something a client OPENS, and only the marked form addresses a
   * channel — the raw id would resolve to an unrelated user.
   *
   * @param peer - The peer to render.
   * @returns The marked decimal id, or `''` for an unrecognised peer.
   * @throws Never.
   */
  private markedPeerId(peer: Api.TypePeer): string {
    if (peer instanceof Api.PeerUser) return peer.userId.toString();
    if (peer instanceof Api.PeerChat) return `-${peer.chatId.toString()}`;
    if (peer instanceof Api.PeerChannel)
      return `-100${peer.channelId.toString()}`;
    return '';
  }

  /**
   * Resolves the `@username` of the bot an inline result was sent through.
   *
   * Reads only the entity GramJS already attached to the message, never a
   * lookup, for the same reason {@link GramjsClientAdapter.senderDisplayName}
   * does: one extra round-trip per message is a flood-wait risk. An unresolved
   * bot is omitted rather than guessed at.
   *
   * @param message - The message to inspect.
   * @returns The bot username without its `@`, or `undefined`.
   * @throws Never.
   */
  private viaBotUsername(message: Api.Message): string | undefined {
    if (message.viaBotId === undefined) return undefined;
    const bot = message.viaBot;
    return bot instanceof Api.User ? (bot.username ?? undefined) : undefined;
  }

  /**
   * Extracts the replied-to message id, when a message is a reply to another
   * *message* (a reply to a story or other non-message target has no msg id).
   *
   * Reads the raw `replyTo` header rather than GramJS' `replyToMsgId` getter so
   * the mapping also works on the plain fixture objects used in tests.
   *
   * @param message - The message to inspect.
   * @returns The replied-to message id, or `undefined` when not a message reply.
   * @throws Never.
   */
  private replyToMsgId(message: Api.Message): number | undefined {
    const replyTo = message.replyTo;
    return replyTo instanceof Api.MessageReplyHeader
      ? replyTo.replyToMsgId
      : undefined;
  }

  /**
   * Derives a best-effort display name from an **already-resolved** sender
   * entity. Never triggers a network fetch (the caller passes GramJS' cached
   * `message.sender`), so it stays flood-safe; returns `undefined` when the
   * sender is unresolved or nameless.
   *
   * @param sender - The resolved sender entity, if GramJS attached one.
   * @returns The sender's display name, or `undefined`.
   * @throws Never.
   */
  private senderDisplayName(
    sender: Api.TypeUser | Api.TypeChat | undefined,
  ): string | undefined {
    if (sender instanceof Api.User) {
      const fullName = [sender.firstName, sender.lastName]
        .filter((part): part is string => Boolean(part))
        .join(' ');
      return fullName || sender.username || undefined;
    }
    if (sender instanceof Api.Chat || sender instanceof Api.Channel)
      return sender.title || undefined;
    return undefined;
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
   * Fetches a single message by id and returns it only when it carries
   * downloadable media. Used by the media-info / range / stream operations.
   *
   * @param peer - Peer the message belongs to.
   * @param messageId - Id of the message to fetch.
   * @returns The message when it has non-empty media, else `undefined`.
   * @throws Propagates the GramJS error (callers wrap it).
   */
  private async fetchMediaMessage(
    peer: GramPeer,
    messageId: number,
  ): Promise<Api.Message | undefined> {
    const [message] = await this.client.getMessages(peer, {
      ids: [messageId],
    });
    if (!message || !this.hasDownloadableMedia(message)) return undefined;
    return message;
  }

  /**
   * Maps a message's media into a {@link GramMediaInfo}.
   *
   * @param media - The message media (already known to be non-empty).
   * @returns The descriptor, or `undefined` for media with no file body
   *   (e.g. a web-page preview or geo point).
   * @throws Never.
   */
  private mapMediaInfo(
    media: Api.TypeMessageMedia | undefined,
  ): GramMediaInfo | undefined {
    // ── Photos have no single byte size here; report the kind only. ─────────
    if (media instanceof Api.MessageMediaPhoto)
      return { kind: GRAM_MEDIA_KINDS.PHOTO, mimeType: 'image/jpeg' };

    if (!(media instanceof Api.MessageMediaDocument)) return undefined;
    const doc = media.document;
    if (!(doc instanceof Api.Document)) return undefined;

    const video = doc.attributes.find(
      (a): a is Api.DocumentAttributeVideo =>
        a instanceof Api.DocumentAttributeVideo,
    );
    const audio = doc.attributes.find(
      (a): a is Api.DocumentAttributeAudio =>
        a instanceof Api.DocumentAttributeAudio,
    );
    const named = doc.attributes.find(
      (a): a is Api.DocumentAttributeFilename =>
        a instanceof Api.DocumentAttributeFilename,
    );

    // ── A video attribute wins; otherwise an audio attribute distinguishes a
    //    voice note from music; otherwise it is a plain document. ────────────
    let kind: GramMediaKind = GRAM_MEDIA_KINDS.DOCUMENT;
    if (video) kind = GRAM_MEDIA_KINDS.VIDEO;
    else if (audio)
      kind = audio.voice ? GRAM_MEDIA_KINDS.VOICE : GRAM_MEDIA_KINDS.AUDIO;

    return {
      kind,
      mimeType: doc.mimeType,
      size: doc.size.toJSNumber(),
      fileName: named?.fileName,
      durationSeconds: video?.duration ?? audio?.duration,
      width: video?.w,
      height: video?.h,
      supportsStreaming: video?.supportsStreaming,
    };
  }

  /**
   * Maps a GramJS resolved entity into a {@link GramChatInfo}, merging in the
   * description / participant count read from a matching "full" request.
   *
   * Classification, title and username all come from the shared entity
   * readers, so a peer described here and the same peer described by a search
   * result cannot disagree — which they did while this read the legacy
   * `username` scalar directly and reported collectible (Fragment) usernames
   * as absent.
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
    return {
      id: entity.id.toString(),
      type: this.entityDialogType(entity),
      title: this.entityTitle(entity),
      // ── `?? undefined` because this DTO's field is optional, while the
      //    shared reader answers `null` for "the peer has none". ────────────
      username: this.entityUsername(entity) ?? undefined,
      about,
      // ── A user never has a member count, whatever the caller passed. ─────
      participantsCount:
        entity instanceof Api.User ? undefined : participantsCount,
      // ── Only users and channels carry the badge; a basic group cannot. ───
      verified: entity instanceof Api.Chat ? false : Boolean(entity.verified),
    };
  }
  /**
   * Turns a library search filter into the TL `inputMessagesFilter*` it names.
   *
   * @param filter - The filter to translate, if the caller named one.
   * @returns The TL filter instance, or `undefined` for an unfiltered search.
   * @throws Never.
   */
  private toInputFilter(
    filter: GramSearchFilter | undefined,
  ): Api.TypeMessagesFilter | undefined {
    return filter ? SEARCH_FILTER_FACTORIES[filter]() : undefined;
  }

  /**
   * Indexes the `users`/`chats` a peer-carrying response ships beside its bare
   * peer references, so each reference can be titled without a round trip.
   *
   * Keys are RAW ids because that is what an `Api.Peer*` carries; the marked
   * form is built later by {@link GramjsClientAdapter.markedPeerId}.
   *
   * @param users - The response's `users` vector.
   * @param chats - The response's `chats` vector.
   * @returns The two lookup maps.
   * @throws Never.
   */
  private indexPeerEntities(
    users: Api.TypeUser[],
    chats: Api.TypeChat[],
  ): PeerEntityIndex {
    const userIndex = new Map<string, Api.User>();
    for (const user of users)
      if (user instanceof Api.User) userIndex.set(user.id.toString(), user);

    const chatIndex = new Map<string, Api.Chat | Api.Channel>();
    for (const chat of chats)
      if (chat instanceof Api.Chat || chat instanceof Api.Channel)
        chatIndex.set(chat.id.toString(), chat);

    return { users: userIndex, chats: chatIndex };
  }

  /**
   * Looks a bare peer reference up in an index built by
   * {@link GramjsClientAdapter.indexPeerEntities}.
   *
   * @param peer - The peer reference to resolve.
   * @param index - The entities that came with the same response.
   * @returns The resolved entity, or `undefined` when the response omitted it.
   * @throws Never.
   */
  private resolvePeerEntity(
    peer: Api.TypePeer,
    index: PeerEntityIndex,
  ): Api.User | Api.Chat | Api.Channel | undefined {
    if (peer instanceof Api.PeerUser)
      return index.users.get(peer.userId.toString());
    if (peer instanceof Api.PeerChat)
      return index.chats.get(peer.chatId.toString());
    if (peer instanceof Api.PeerChannel)
      return index.chats.get(peer.channelId.toString());
    return undefined;
  }

  /**
   * Maps one bare peer reference into a {@link GramDialogRef}.
   *
   * @param peer - The peer reference to map.
   * @param index - The entities that came with the same response.
   * @returns The peer ref, or `undefined` when its entity was not sent.
   * @throws Never.
   */
  private mapPeerRef(
    peer: Api.TypePeer,
    index: PeerEntityIndex,
  ): GramDialogRef | undefined {
    const entity = this.resolvePeerEntity(peer, index);
    if (!entity) return undefined;
    return {
      // ── The MARKED id, as `GramDialog.id` is, so the caller can pass it
      //    straight back as a peer — the raw id of a channel addresses an
      //    unrelated user. ────────────────────────────────────────────────
      id: this.markedPeerId(peer),
      type: this.entityDialogType(entity),
      title: this.entityTitle(entity),
      username: this.entityUsername(entity),
      hasPhoto: this.entityHasPhoto(entity) ?? false,
    };
  }

  /**
   * Maps a vector of bare peer references, dropping any whose entity the
   * response did not carry — a blank row is worse than a missing one.
   *
   * @param peers - The peer references to map.
   * @param index - The entities that came with the same response.
   * @returns The peer refs that could be resolved, in the order given.
   * @throws Never.
   */
  private mapPeerRefs(
    peers: Api.TypePeer[],
    index: PeerEntityIndex,
  ): GramDialogRef[] {
    return peers.flatMap((peer) => {
      const ref = this.mapPeerRef(peer, index);
      return ref ? [ref] : [];
    });
  }

  /**
   * Classifies a resolved entity as a user, group, or channel.
   *
   * A basic group (`Api.Chat`) is always a group; an `Api.Channel` is a
   * channel unless its `megagroup` flag marks it as a supergroup.
   *
   * @param entity - The resolved entity.
   * @returns The matching dialog kind.
   * @throws Never.
   */
  private entityDialogType(
    entity: Api.User | Api.Chat | Api.Channel,
  ): GramDialogType {
    if (entity instanceof Api.User) return GRAM_DIALOG_TYPES.USER;
    if (entity instanceof Api.Chat) return GRAM_DIALOG_TYPES.GROUP;
    return entity.megagroup
      ? GRAM_DIALOG_TYPES.GROUP
      : GRAM_DIALOG_TYPES.CHANNEL;
  }

  /**
   * Reads an entity's display title — a chat/channel title, or a user's first
   * and last name joined.
   *
   * @param entity - The resolved entity.
   * @returns The title; `''` for a user with neither name set.
   * @throws Never.
   */
  private entityTitle(entity: Api.User | Api.Chat | Api.Channel): string {
    if (!(entity instanceof Api.User)) return entity.title;
    return [entity.firstName, entity.lastName]
      .filter((part): part is string => Boolean(part))
      .join(' ');
  }

  /**
   * Reads an entity's public `@username`, without the `@`.
   *
   * Falls back to the `usernames` VECTOR when the legacy scalar field is
   * empty: Telegram leaves the scalar unset for a COLLECTIBLE (Fragment)
   * username and puts it in the vector instead, so reading only the scalar
   * reports `@durov`-style collectible handles as having no username at all.
   * The scalar still wins when both are present — it is the primary handle.
   *
   * @param entity - The resolved entity.
   * @returns The username without its `@`, or `null` when the peer has none
   *   (a basic group never does).
   * @throws Never.
   */
  private entityUsername(
    entity: Api.User | Api.Chat | Api.Channel,
  ): string | null {
    if (entity instanceof Api.Chat) return null;
    if (entity.username) return entity.username;
    const active = entity.usernames?.find((name) => name.active);
    return active?.username ?? null;
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

  /**
   * Maps a GramJS deleted-message event into a {@link GramDeletedMessages}.
   *
   * GramJS only carries the originating peer for channel/supergroup deletions
   * (`UpdateDeleteChannelMessages` → an `Api.PeerChannel`); private-chat and
   * small-group deletions arrive without one, so `peerId` is left `undefined`.
   *
   * @param event - The GramJS `DeletedMessageEvent`.
   * @returns The normalized deletion DTO.
   * @throws Never.
   */
  private mapDeletedMessages(event: DeletedMessageEvent): GramDeletedMessages {
    const peer = event.peer;
    return {
      messageIds: event.deletedIds,
      peerId:
        peer instanceof Api.PeerChannel ? peer.channelId.toString() : undefined,
    };
  }

  /**
   * Maps a raw typing/presence update into a {@link GramChatActionEvent}.
   *
   * @param update - The raw `Api.TypeUpdate` delivered by the `Raw` event.
   * @returns The normalized event, or `undefined` for an update kind (or user
   *   status) this library does not surface.
   * @throws Never.
   */
  private mapChatAction(
    update: Api.TypeUpdate,
  ): GramChatActionEvent | undefined {
    // ── Private chat: the acting user is also the peer. ──────────────────────
    if (update instanceof Api.UpdateUserTyping)
      return {
        peerId: update.userId.toString(),
        userId: update.userId.toString(),
        action: this.mapSendMessageAction(update.action),
      };

    // ── Basic group: peer is the chat; the actor is `fromId`. ────────────────
    if (update instanceof Api.UpdateChatUserTyping)
      return {
        peerId: update.chatId.toString(),
        userId: this.peerToString(update.fromId) || undefined,
        action: this.mapSendMessageAction(update.action),
      };

    // ── Channel/supergroup: peer is the channel; the actor is `fromId`. ──────
    if (update instanceof Api.UpdateChannelUserTyping)
      return {
        peerId: update.channelId.toString(),
        userId: this.peerToString(update.fromId) || undefined,
        action: this.mapSendMessageAction(update.action),
      };

    // ── Presence: only the explicit online/offline transitions are surfaced;
    //    the coarse "last seen recently/week/month" statuses are dropped. ─────
    if (update instanceof Api.UpdateUserStatus) {
      const action = this.mapUserStatus(update.status);
      if (!action) return undefined;
      return {
        peerId: update.userId.toString(),
        userId: update.userId.toString(),
        action,
      };
    }

    return undefined;
  }

  /**
   * Maps a GramJS `SendMessageAction` into a {@link GramChatAction}.
   *
   * @param action - The action carried by a typing update.
   * @returns The matching action kind, or {@link GRAM_CHAT_ACTIONS.UNKNOWN}.
   * @throws Never.
   */
  private mapSendMessageAction(
    action: Api.TypeSendMessageAction,
  ): GramChatAction {
    if (action instanceof Api.SendMessageTypingAction)
      return GRAM_CHAT_ACTIONS.TYPING;
    if (action instanceof Api.SendMessageCancelAction)
      return GRAM_CHAT_ACTIONS.CANCEL;
    if (action instanceof Api.SendMessageRecordVideoAction)
      return GRAM_CHAT_ACTIONS.RECORDING_VIDEO;
    if (action instanceof Api.SendMessageUploadVideoAction)
      return GRAM_CHAT_ACTIONS.UPLOADING_VIDEO;
    if (action instanceof Api.SendMessageRecordAudioAction)
      return GRAM_CHAT_ACTIONS.RECORDING_VOICE;
    if (action instanceof Api.SendMessageUploadAudioAction)
      return GRAM_CHAT_ACTIONS.UPLOADING_AUDIO;
    if (action instanceof Api.SendMessageUploadPhotoAction)
      return GRAM_CHAT_ACTIONS.UPLOADING_PHOTO;
    if (action instanceof Api.SendMessageUploadDocumentAction)
      return GRAM_CHAT_ACTIONS.UPLOADING_DOCUMENT;
    if (action instanceof Api.SendMessageRecordRoundAction)
      return GRAM_CHAT_ACTIONS.RECORDING_ROUND;
    if (action instanceof Api.SendMessageUploadRoundAction)
      return GRAM_CHAT_ACTIONS.UPLOADING_ROUND;
    if (action instanceof Api.SendMessageGeoLocationAction)
      return GRAM_CHAT_ACTIONS.PICKING_LOCATION;
    if (action instanceof Api.SendMessageChooseContactAction)
      return GRAM_CHAT_ACTIONS.CHOOSING_CONTACT;
    if (action instanceof Api.SendMessageChooseStickerAction)
      return GRAM_CHAT_ACTIONS.CHOOSING_STICKER;
    if (action instanceof Api.SendMessageGamePlayAction)
      return GRAM_CHAT_ACTIONS.PLAYING_GAME;
    return GRAM_CHAT_ACTIONS.UNKNOWN;
  }

  /**
   * Maps a GramJS `UserStatus` into the matching presence
   * {@link GramChatAction}, or `undefined` for the coarse "last seen" statuses
   * that carry no precise online/offline edge.
   *
   * @param status - The user status from an `UpdateUserStatus`.
   * @returns `ONLINE` / `OFFLINE`, or `undefined` to drop the update.
   * @throws Never.
   */
  private mapUserStatus(
    status: Api.TypeUserStatus,
  ): GramChatAction | undefined {
    if (status instanceof Api.UserStatusOnline) return GRAM_CHAT_ACTIONS.ONLINE;
    if (status instanceof Api.UserStatusOffline)
      return GRAM_CHAT_ACTIONS.OFFLINE;
    return undefined;
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
    // ── Surface Telegram's FLOOD_WAIT delay (seconds) and the raw MTProto code
    //    on the typed error so the retry helper can back off for exactly the
    //    requested interval and callers can classify auth-loss without reaching
    //    into `cause`. Reading the GramJS error shape stays confined here. ─────
    return new TelegramClientError(message, {
      operation,
      retryAfterSeconds: this.floodWaitSeconds(error),
      rpcCode: this.rpcErrorCode(error),
      cause: error,
    });
  }

  /**
   * Extracts the raw MTProto error code from a GramJS `RPCError` (its
   * `errorMessage`, e.g. `AUTH_KEY_UNREGISTERED`), or `undefined` for a
   * non-RPC (transport / generic) failure. Keeps the GramJS error shape
   * confined to this adapter.
   *
   * @param error - The caught value (typically a raw GramJS error).
   * @returns The RPC error code string, or `undefined`.
   * @throws Never.
   */
  private rpcErrorCode(error: unknown): string | undefined {
    return error instanceof errors.RPCError ? error.errorMessage : undefined;
  }

  /**
   * Extracts the FLOOD_WAIT delay (seconds) from a GramJS error, or `undefined`
   * when the error is not a rate-limit. Recognizes both the typed
   * `FloodWaitError` (delay on `.seconds`) and the plain `FLOOD_WAIT_<n>`
   * message shape; any other error yields `undefined` so non-rate-limit
   * failures are never treated as retryable.
   *
   * @param error - The caught value (typically a raw GramJS error).
   * @returns The flood-wait delay in seconds, or `undefined`.
   * @throws Never.
   */
  private floodWaitSeconds(error: unknown): number | undefined {
    if (error instanceof errors.FloodWaitError) return error.seconds;
    const message = this.readErrorMessage(error);
    return message.startsWith('FLOOD_WAIT')
      ? this.readFloodSeconds(error, message)
      : undefined;
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
   * Maps an `auth.acceptLoginToken` failure into a typed {@link TelegramAuthError}.
   *
   * The accept runs on the LIVE (already-authorized) session, so its failure set
   * differs from an interactive sign-in: it is dominated by the QR token's
   * lifecycle (`AUTH_TOKEN_*`), plus the possibility that this very session has
   * lost its authorization (an auth-loss RPC → `NOT_AUTHORIZED`, classified via
   * the shared {@link TELEGRAM_AUTH_LOSS_RPC_CODES} set so
   * {@link import('../common').isAuthorizationLostError} recognizes it) and
   * Telegram's flood-wait rate limit.
   *
   * @param error - The caught value (typically a raw GramJS `RPCError`).
   * @returns A {@link TelegramAuthError} with a precise code (`UNKNOWN` when the
   *   failure matches none of the accept-specific cases).
   * @throws Never.
   */
  private toAcceptLoginTokenError(error: unknown): TelegramAuthError {
    if (error instanceof TelegramAuthError) return error;

    // ── FloodWaitError carries the delay on `.seconds` (its `errorMessage` is
    //    the bare "FLOOD"), so detect it by type before matching on text. ──────
    if (error instanceof errors.FloodWaitError)
      return new TelegramAuthError(
        'FLOOD_WAIT',
        `Telegram flood wait: ${error.seconds}s required`,
        { retryAfterSeconds: error.seconds, cause: error },
      );

    const message = this.readErrorMessage(error);
    let code: TelegramAuthErrorCode = 'UNKNOWN';
    let retryAfterSeconds: number | undefined;

    if (message.startsWith('AUTH_TOKEN_EXPIRED')) code = 'TOKEN_EXPIRED';
    else if (message.startsWith('AUTH_TOKEN_ALREADY_ACCEPTED'))
      code = 'TOKEN_ALREADY_ACCEPTED';
    // ── `AUTH_TOKEN_INVALID` and `AUTH_TOKEN_EXCEPTION` (token failed to import)
    //    both mean "bad token". Prefix-matched, since Telegram suffixes RPC codes
    //    (`AUTH_TOKEN_INVALIDX`) and a suffixed variant must not fall through to
    //    UNKNOWN — the caller would lose the bad-token/unexpected distinction. ──
    else if (
      message.startsWith('AUTH_TOKEN_INVALID') ||
      message.startsWith('AUTH_TOKEN_EXCEPTION')
    )
      code = 'TOKEN_INVALID';
    else if ((TELEGRAM_AUTH_LOSS_RPC_CODES as readonly string[]).includes(message))
      // ── This session itself is dead (revoked/expired/deactivated): it cannot
      //    approve a login. Surface NOT_AUTHORIZED so the caller can tear down. ─
      code = 'NOT_AUTHORIZED';
    else if (message.startsWith('FLOOD_WAIT')) {
      // ── Fallback for a non-typed error whose message embeds FLOOD_WAIT_N. ──
      code = 'FLOOD_WAIT';
      retryAfterSeconds = this.readFloodSeconds(error, message);
    }

    return new TelegramAuthError(
      code,
      `Telegram QR login accept failed: ${message}`,
      { retryAfterSeconds, cause: error },
    );
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

  return new GramJsClientAdapter(
    client,
    stringSession,
    { apiId: options.apiId, apiHash: options.apiHash },
    options.connectTimeoutMs,
  );
}
