/**
 * @file src/lib/bot/updates/telegram-update.types.ts
 *
 * PURPOSE
 * -------
 * Shared types and metadata keys for the Bot API decorator system: the closed
 * set of update "kinds" a method can bind to, the discriminated binding
 * descriptor stored per method, the parameter-injection descriptors used by the
 * argument resolver, and the reflect-metadata keys the registrar reads.
 *
 * No `enum` is used anywhere — closed sets are modelled as `as const` records
 * plus derived union types (see CLAUDE.md).
 *
 * USAGE
 * -----
 * Internal to `src/lib/bot/updates`; the public surface is the decorators that
 * produce these descriptors and the registrar that consumes them.
 *
 * KEY EXPORTS
 * -----------
 * - BOT_UPDATE_KINDS / BotUpdateKind: the method-binding kinds.
 * - UpdateBinding: discriminated descriptor of a single `@Start`/`@Command`/… binding.
 * - PARAM_KINDS / ParamKind: the parameter-injection kinds.
 * - ParamMetadata: a single decorated-parameter descriptor.
 * - TelegramUpdateHandler: the call-shape of a decorated handler method.
 * - *_METADATA: reflect-metadata keys (including the per-provider target bot).
 */

import type { Telegraf, Telegram } from 'telegraf';

// ── Command-menu types (derived from Telegraf, never imported from typegram) ──

/**
 * A single Bot API command descriptor (`{ command, description }`), derived from
 * Telegraf's own `setMyCommands` signature so it stays in lock-step with the
 * installed version instead of importing the `typegram` shape directly.
 */
export type BotCommand = Parameters<Telegram['setMyCommands']>[0][number];

/**
 * The optional `extra` accepted by `setMyCommands` — its `scope` and
 * `language_code`. Derived from Telegraf rather than imported from `typegram`.
 */
export type SetMyCommandsExtra = NonNullable<
  Parameters<Telegram['setMyCommands']>[1]
>;

/**
 * A Bot API command scope (default, all-private-chats, a specific chat, …),
 * derived from {@link SetMyCommandsExtra}. Used by `@Command` to scope an
 * auto-registered command's visibility.
 */
export type BotCommandScope = NonNullable<SetMyCommandsExtra['scope']>;

// ── Update kinds ────────────────────────────────────────────────────────────

/**
 * The closed set of Telegraf registration methods a decorated handler can bind
 * to. Each value is the name of the underlying `Telegraf` method the registrar
 * dispatches to.
 */
export const BOT_UPDATE_KINDS = {
  /** Binds to `bot.start(...)` — the `/start` command. */
  START: 'start',
  /** Binds to `bot.help(...)` — the `/help` command. */
  HELP: 'help',
  /** Binds to `bot.command(name, ...)` — a named slash command. */
  COMMAND: 'command',
  /** Binds to `bot.hears(trigger, ...)` — text matching. */
  HEARS: 'hears',
  /** Binds to `bot.action(trigger, ...)` — callback-query (button) matching. */
  ACTION: 'action',
  /** Binds to `bot.on(updateType, ...)` — a raw update/message type filter. */
  ON: 'on',
  /** Binds to `bot.use(...)` — global middleware run for every update. */
  USE: 'use',
  /**
   * Binds to `bot.inlineQuery(trigger, ...)` — an incoming inline query
   * (`@botname query`). With no trigger the registrar falls back to
   * `bot.on('inline_query', ...)` to match every inline query.
   */
  INLINE_QUERY: 'inlineQuery',
  /**
   * Binds to `bot.on('chosen_inline_result', ...)` — the feedback update fired
   * when a user picks one of the bot's inline results (requires inline feedback
   * enabled via @BotFather).
   */
  CHOSEN_INLINE_RESULT: 'chosenInlineResult',
} as const;

/** A single update-binding kind (the value side of {@link BOT_UPDATE_KINDS}). */
export type BotUpdateKind =
  (typeof BOT_UPDATE_KINDS)[keyof typeof BOT_UPDATE_KINDS];

/**
 * Describes one method ⇄ Telegraf binding produced by a method decorator. The
 * trigger types are pulled straight from Telegraf's own method signatures via
 * `Parameters<>`, so they always stay in lock-step with the installed version.
 *
 * `start`, `help`, and `use` take no trigger; the rest carry the first argument
 * that would be passed to the matching `Telegraf` method.
 */
export type UpdateBinding =
  | { readonly kind: typeof BOT_UPDATE_KINDS.START }
  | { readonly kind: typeof BOT_UPDATE_KINDS.HELP }
  | { readonly kind: typeof BOT_UPDATE_KINDS.USE }
  | {
      readonly kind: typeof BOT_UPDATE_KINDS.COMMAND;
      /** Command name(s) forwarded to `Telegraf.command`. */
      readonly trigger: Parameters<Telegraf['command']>[0];
      /**
       * Human-readable description for the Telegram command menu. Present only
       * when supplied via `@Command(name, { description })`; when set (and the
       * module's `commands.autoRegister` is on) the command is included in the
       * `setMyCommands` payload derived at bootstrap. Omitted commands are still
       * handled — they just never appear in the menu.
       */
      readonly description?: string;
      /**
       * Optional command-menu scope (e.g. all private chats, a specific chat).
       * Commands sharing a `scope`/`languageCode` are registered together in one
       * `setMyCommands` call. Omit for the default scope (all users).
       */
      readonly scope?: BotCommandScope;
      /**
       * Optional two-letter language code the description applies to. Omit to set
       * the language-agnostic default. Grouped with `scope` for registration.
       */
      readonly languageCode?: string;
    }
  | {
      readonly kind: typeof BOT_UPDATE_KINDS.HEARS;
      /** Text trigger(s) forwarded to `Telegraf.hears`. */
      readonly trigger: Parameters<Telegraf['hears']>[0];
    }
  | {
      readonly kind: typeof BOT_UPDATE_KINDS.ACTION;
      /** Callback-data trigger(s) forwarded to `Telegraf.action`. */
      readonly trigger: Parameters<Telegraf['action']>[0];
    }
  | {
      readonly kind: typeof BOT_UPDATE_KINDS.ON;
      /** Update-type filter(s) forwarded to `Telegraf.on`. */
      readonly trigger: Parameters<Telegraf['on']>[0];
    }
  | {
      readonly kind: typeof BOT_UPDATE_KINDS.INLINE_QUERY;
      /**
       * Optional inline-query pattern(s) forwarded to `Telegraf.inlineQuery`
       * (string, `RegExp`, or an array thereof). When omitted the handler is
       * bound via `Telegraf.on('inline_query', …)` so it matches every query.
       */
      readonly trigger?: Parameters<Telegraf['inlineQuery']>[0];
    }
  | { readonly kind: typeof BOT_UPDATE_KINDS.CHOSEN_INLINE_RESULT };

// ── Parameter injection ─────────────────────────────────────────────────────

/**
 * The closed set of values a parameter decorator can inject into a handler from
 * the Telegraf {@link import('telegraf').Context}.
 */
export const PARAM_KINDS = {
  /** Injects the raw Telegraf `Context` (`@Ctx()`). */
  CONTEXT: 'context',
  /** Injects the incoming message text, or `undefined` (`@MessageText()`). */
  MESSAGE_TEXT: 'message_text',
  /** Injects the triggering `User` (`ctx.from`), or `undefined` (`@Sender()`). */
  SENDER: 'sender',
  /** Injects a callback query's `data` string, or `undefined` (`@CallbackData()`). */
  CALLBACK_DATA: 'callback_data',
  /**
   * Injects the inline query's text (`ctx.inlineQuery.query`), or `undefined`
   * when the update is not an inline query (`@InlineQueryText()`).
   */
  INLINE_QUERY_TEXT: 'inline_query_text',
  /**
   * Injects the inline query's pagination offset (`ctx.inlineQuery.offset`), or
   * `undefined` when the update is not an inline query (`@InlineQueryOffset()`).
   */
  INLINE_QUERY_OFFSET: 'inline_query_offset',
} as const;

/** A single parameter-injection kind (the value side of {@link PARAM_KINDS}). */
export type ParamKind = (typeof PARAM_KINDS)[keyof typeof PARAM_KINDS];

/** Describes one decorated handler parameter: which slot and what to inject. */
export interface ParamMetadata {
  /** Zero-based position of the parameter in the method signature. */
  readonly index: number;
  /** What value the resolver injects at that position. */
  readonly kind: ParamKind;
}

// ── Handler shape ───────────────────────────────────────────────────────────

/**
 * The call-shape of a decorated handler method. Arguments are produced by the
 * argument resolver, so they are intentionally loose (`unknown[]`); the concrete
 * per-parameter types come from the consumer's own annotations.
 */
export type TelegramUpdateHandler = (
  ...args: readonly unknown[]
) => unknown | Promise<unknown>;

// ── Reflect-metadata keys ───────────────────────────────────────────────────

/** Marks a class as a `@TelegramUpdate` provider the registrar should scan. */
export const IS_TELEGRAM_UPDATE_METADATA = 'nestjs-telegram:is-telegram-update';

/** Holds the array of {@link UpdateBinding}s attached to a handler method. */
export const UPDATE_BINDINGS_METADATA = 'nestjs-telegram:update-bindings';

/** Holds the array of {@link ParamMetadata} attached to a handler method. */
export const UPDATE_PARAMS_METADATA = 'nestjs-telegram:update-params';

/**
 * Holds the name of the bot a `@TelegramUpdate` provider's handlers bind to.
 * Recorded on the class by `@TelegramUpdate({ bot })`; defaults to
 * {@link import('../telegram-bot.constants').DEFAULT_BOT_NAME} when omitted. The
 * registrar reads it to scope discovered handlers to the bot it was created for,
 * so handlers are never bound onto more than one bot in a multi-bot app.
 */
export const TELEGRAM_UPDATE_BOT_METADATA = 'nestjs-telegram:update-bot';
