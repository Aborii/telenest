/**
 * @file src/lib/bot/updates/telegram-update.decorator.ts
 *
 * PURPOSE
 * -------
 * The class and method decorators that make a NestJS provider a first-class Bot
 * API update handler. `@TelegramUpdate()` marks the class so the registrar scans
 * it; the method decorators (`@Start`, `@Help`, `@Command`, `@Hears`, `@Action`,
 * `@On`, `@Use`, `@InlineQuery`, `@ChosenInlineResult`) record how each method
 * binds onto the underlying `Telegraf` instance. Multiple method decorators may
 * be stacked on one method — each appends a binding.
 *
 * USAGE
 * -----
 * ```ts
 * @TelegramUpdate()
 * export class GreeterUpdate {
 *   @Start() onStart(@Ctx() ctx: Context) { return ctx.reply('hi'); }
 *   @Command('ping') onPing(@Ctx() ctx: Context) { return ctx.reply('pong'); }
 * }
 *
 * // Scope a provider's handlers to a specific named bot (multi-bot apps):
 * @TelegramUpdate({ bot: 'support' })
 * export class SupportUpdate {
 *   @Command('ticket') onTicket(@Ctx() ctx: Context) { return ctx.reply('opened'); }
 * }
 * ```
 *
 * KEY EXPORTS
 * -----------
 * - TelegramUpdate: class decorator marking an update provider (optionally
 *   scoped to a named bot).
 * - TelegramUpdateOptions: options accepted by `@TelegramUpdate`.
 * - Start / Help / Command / Hears / Action / CallbackAction / On / Use /
 *   InlineQuery / ChosenInlineResult / PreCheckoutQuery / ShippingQuery /
 *   SuccessfulPayment: method decorators.
 */

import 'reflect-metadata';

import { SetMetadata } from '@nestjs/common';
import type { Telegraf } from 'telegraf';

import type { CallbackActionSchema } from '../callback-action.codec';
import { DEFAULT_BOT_NAME } from '../telegram-bot.constants';
import {
  BOT_UPDATE_KINDS,
  IS_TELEGRAM_UPDATE_METADATA,
  TELEGRAM_UPDATE_BOT_METADATA,
  UPDATE_BINDINGS_METADATA,
  type BotCommandScope,
  type UpdateBinding,
} from './telegram-update.types';

/**
 * Appends an {@link UpdateBinding} to a handler method's metadata, preserving any
 * bindings added by other stacked decorators on the same method.
 *
 * @param target - The prototype carrying the method (decorator `target`).
 * @param propertyKey - The decorated method's name.
 * @param binding - The binding descriptor to record.
 * @returns Nothing.
 * @throws Never.
 */
function appendBinding(
  target: object,
  propertyKey: string | symbol,
  binding: UpdateBinding,
): void {
  // ── Metadata is attached to the method function itself, which is the same
  //    reference the registrar later reads off the resolved instance. ────────
  const method = (target as Record<string | symbol, unknown>)[propertyKey] as
    object | undefined;
  if (!method) return;

  const existing =
    (Reflect.getMetadata(UPDATE_BINDINGS_METADATA, method) as
      UpdateBinding[] | undefined) ?? [];
  Reflect.defineMetadata(
    UPDATE_BINDINGS_METADATA,
    [...existing, binding],
    method,
  );
}

/** Options for the {@link TelegramUpdate} class decorator. */
export interface TelegramUpdateOptions {
  /**
   * Name of the registered bot whose updates this provider's handlers bind to.
   * Must match the `name` passed to the corresponding
   * `TelegramBotModule.forRoot({ name })` / `forRootAsync({ name })`. Omit (or
   * pass the default bot name) to bind to the default bot. In a multi-bot app
   * each handler is bound onto exactly one bot — the one named here.
   */
  readonly bot?: string;
}

/**
 * Marks a class as a Telegram update provider. Only methods on classes wearing
 * this decorator are scanned and bound by the registrar.
 *
 * Records two pieces of class metadata: the scan marker, and the **target bot
 * name** (`options.bot`, defaulting to the default bot). The per-bot registrar
 * binds only the providers whose target bot matches the bot it serves, so in a
 * multi-bot application a provider's handlers are never bound onto another bot.
 *
 * @param options - Optional settings; `bot` scopes the provider to a named bot.
 * @returns A class decorator attaching the scan marker and target-bot name.
 * @throws Never.
 *
 * @example
 * ```ts
 * @TelegramUpdate()                 // default bot
 * export class MyUpdate { ... }
 *
 * @TelegramUpdate({ bot: 'notify' }) // the bot registered as `name: 'notify'`
 * export class NotifyUpdate { ... }
 * ```
 */
export function TelegramUpdate(
  options?: TelegramUpdateOptions,
): ClassDecorator {
  const botName = options?.bot ?? DEFAULT_BOT_NAME;
  return (target) => {
    // ── Two markers: "scan me" + which bot these handlers belong to. ──────────
    SetMetadata(IS_TELEGRAM_UPDATE_METADATA, true)(target);
    SetMetadata(TELEGRAM_UPDATE_BOT_METADATA, botName)(target);
  };
}

/**
 * Handles the `/start` command (binds to `Telegraf.start`).
 *
 * @returns A method decorator recording the binding.
 * @throws Never.
 */
export function Start(): MethodDecorator {
  return (target, propertyKey) =>
    appendBinding(target, propertyKey, { kind: BOT_UPDATE_KINDS.START });
}

/**
 * Handles the `/help` command (binds to `Telegraf.help`).
 *
 * @returns A method decorator recording the binding.
 * @throws Never.
 */
export function Help(): MethodDecorator {
  return (target, propertyKey) =>
    appendBinding(target, propertyKey, { kind: BOT_UPDATE_KINDS.HELP });
}

/**
 * Per-command metadata for the Telegram command menu, supplied as the optional
 * second argument to {@link Command}. Only commands given a `description` are
 * eligible for auto-registration via `setMyCommands`; `scope`/`languageCode`
 * further place the command into a specific menu.
 */
export interface CommandOptions {
  /**
   * Human-readable description shown in the Telegram command menu (1–256 chars).
   * Required for a command to be auto-registered; omit to handle the command
   * without listing it in the menu.
   */
  readonly description?: string;
  /**
   * Command-menu scope (e.g. all private chats, a specific chat). Commands that
   * share a `scope`/`languageCode` are registered together. Omit for the default
   * scope (all users).
   */
  readonly scope?: BotCommandScope;
  /**
   * Two-letter language code the description applies to. Omit for the
   * language-agnostic default.
   */
  readonly languageCode?: string;
}

/**
 * Handles one or more named slash commands (binds to `Telegraf.command`).
 *
 * Pass `options.description` to additionally surface the command in the Telegram
 * command menu when the module's `commands.autoRegister` flag is enabled — the
 * registrar derives a `setMyCommands` payload from every described command at
 * bootstrap. When `trigger` is an array, the same description/scope is applied to
 * each name. Commands without a description are handled but never listed.
 *
 * @param trigger - Command name(s), e.g. `'ping'` or `['ping', 'pong']`.
 * @param options - Optional command-menu metadata (`description`, `scope`,
 *   `languageCode`).
 * @returns A method decorator recording the binding.
 * @throws Never.
 *
 * @example
 * ```ts
 * @Command('ping', { description: 'Check the bot is alive' })
 * onPing(@Ctx() ctx: Context) { return ctx.reply('pong'); }
 * ```
 */
export function Command(
  trigger: Parameters<Telegraf['command']>[0],
  options?: CommandOptions,
): MethodDecorator {
  return (target, propertyKey) =>
    appendBinding(target, propertyKey, {
      kind: BOT_UPDATE_KINDS.COMMAND,
      trigger,
      // ── Only attach menu fields that were actually supplied, so a plain
      //    @Command('x') binding stays free of undefined menu metadata. ────────
      ...(options?.description !== undefined && {
        description: options.description,
      }),
      ...(options?.scope !== undefined && { scope: options.scope }),
      ...(options?.languageCode !== undefined && {
        languageCode: options.languageCode,
      }),
    });
}

/**
 * Handles text matching a trigger (binds to `Telegraf.hears`).
 *
 * @param trigger - String, `RegExp`, predicate, or an array thereof.
 * @returns A method decorator recording the binding.
 * @throws Never.
 */
export function Hears(
  trigger: Parameters<Telegraf['hears']>[0],
): MethodDecorator {
  return (target, propertyKey) =>
    appendBinding(target, propertyKey, {
      kind: BOT_UPDATE_KINDS.HEARS,
      trigger,
    });
}

/**
 * Handles inline-keyboard callback queries matching a trigger (binds to
 * `Telegraf.action`).
 *
 * @param trigger - Callback-data string, `RegExp`, predicate, or array thereof.
 * @returns A method decorator recording the binding.
 * @throws Never.
 */
export function Action(
  trigger: Parameters<Telegraf['action']>[0],
): MethodDecorator {
  return (target, propertyKey) =>
    appendBinding(target, propertyKey, {
      kind: BOT_UPDATE_KINDS.ACTION,
      trigger,
    });
}

/**
 * Routes a callback query to this handler by **action key**, using the typed
 * callback-action router layered over the callback-data codec. Build the matching
 * button data with
 * {@link import('../callback-action.codec').encodeCallbackAction}; the registrar
 * decodes each query's `{ a, d? }` envelope and dispatches here when `a` equals
 * `key`. Unknown, oversized, or legacy callback data simply does not match, so a
 * stray button press is ignored rather than throwing.
 *
 * Pass `schema` to validate the decoded payload (`d`): a
 * {@link import('../param.decorators').CallbackPayload} parameter is parsed
 * through it, and a thrown validation error is routed to the handler's exception
 * filters. Omit it to inject the payload untyped (`unknown`). The decorator
 * composes with `@UseTelegramGuards`/`Interceptors`/`Filters` like any other
 * handler.
 *
 * @typeParam P - The validated payload shape, inferred from `schema`.
 * @param key - The non-empty action key this handler claims.
 * @param schema - Optional runtime validator/parser for the decoded payload.
 * @returns A method decorator recording the binding.
 * @throws Never.
 *
 * @example
 * ```ts
 * // sender:
 * const data = encodeCallbackAction('buy', { id: 42 });
 * new InlineKeyboardBuilder().callback('Buy', data).build();
 *
 * // handler:
 * type Buy = { id: number };
 * @CallbackAction('buy', (v): Buy => {
 *   if (typeof v === 'object' && v !== null && typeof (v as Buy).id === 'number')
 *     return v as Buy;
 *   throw new Error('invalid buy payload');
 * })
 * onBuy(@CallbackPayload() payload: Buy, @Ctx() ctx: Context) {
 *   return ctx.answerCbQuery(`Buying #${payload.id}`);
 * }
 * ```
 */
export function CallbackAction<P = unknown>(
  key: string,
  schema?: CallbackActionSchema<P>,
): MethodDecorator {
  return (target, propertyKey) =>
    appendBinding(target, propertyKey, {
      kind: BOT_UPDATE_KINDS.CALLBACK_ACTION,
      key,
      // ── Store the schema only when supplied; the router validates the payload
      //    on injection when present, and injects it untyped otherwise. The cast
      //    widens the inferred parser to the metadata's `unknown` payload type. ─
      ...(schema !== undefined && {
        schema: schema as CallbackActionSchema<unknown>,
      }),
    });
}

/**
 * Handles a raw update/message type (binds to `Telegraf.on`), e.g. `@On('text')`.
 *
 * @param trigger - Update-type filter(s) forwarded to `Telegraf.on`.
 * @returns A method decorator recording the binding.
 * @throws Never.
 */
export function On(trigger: Parameters<Telegraf['on']>[0]): MethodDecorator {
  return (target, propertyKey) =>
    appendBinding(target, propertyKey, {
      kind: BOT_UPDATE_KINDS.ON,
      trigger,
    });
}

/**
 * Registers the method as global middleware run for every update (binds to
 * `Telegraf.use`). Because middleware runs in registration order, ordering
 * across providers follows discovery order.
 *
 * @returns A method decorator recording the binding.
 * @throws Never.
 */
export function Use(): MethodDecorator {
  return (target, propertyKey) =>
    appendBinding(target, propertyKey, { kind: BOT_UPDATE_KINDS.USE });
}

/**
 * Handles incoming inline queries — a bot invoked via `@botname query` from any
 * chat (binds to `Telegraf.inlineQuery`). Answer with
 * {@link import('../telegram-bot.service').TelegramBotService.answerInlineQuery}
 * (or `ctx.answerInlineQuery`), building results with the
 * {@link import('../inline-query-result.builder').InlineQueryResultBuilder}.
 *
 * Pass `pattern` to only handle queries whose text matches it (string, `RegExp`,
 * or an array thereof, forwarded verbatim to `Telegraf.inlineQuery`); omit it to
 * match **every** inline query, in which case the binding falls back to
 * `Telegraf.on('inline_query', …)`.
 *
 * @param pattern - Optional inline-query text pattern(s) to match.
 * @returns A method decorator recording the binding.
 * @throws Never.
 *
 * @example
 * ```ts
 * @InlineQuery()
 * async onQuery(@InlineQueryText() text: string | undefined, @Ctx() ctx: Context) {
 *   const results = new InlineQueryResultBuilder()
 *     .article({ title: 'Echo', text: text ?? '' })
 *     .build();
 *   await ctx.answerInlineQuery(results);
 * }
 * ```
 */
export function InlineQuery(
  pattern?: Parameters<Telegraf['inlineQuery']>[0],
): MethodDecorator {
  return (target, propertyKey) =>
    appendBinding(target, propertyKey, {
      kind: BOT_UPDATE_KINDS.INLINE_QUERY,
      // ── Only record a trigger when one was supplied; a bare @InlineQuery()
      //    stays trigger-free so the registrar matches every inline query. ─────
      ...(pattern !== undefined && { trigger: pattern }),
    });
}

/**
 * Handles the `chosen_inline_result` update — fired when a user picks one of the
 * bot's inline results (binds to `Telegraf.on('chosen_inline_result', …)`).
 *
 * Telegram only delivers these once **inline feedback** is enabled for the bot
 * via @BotFather; without it the handler simply never fires.
 *
 * @returns A method decorator recording the binding.
 * @throws Never.
 *
 * @example
 * ```ts
 * @ChosenInlineResult()
 * onChosen(@Ctx() ctx: Context) {
 *   this.analytics.track(ctx.chosenInlineResult?.result_id);
 * }
 * ```
 */
export function ChosenInlineResult(): MethodDecorator {
  return (target, propertyKey) =>
    appendBinding(target, propertyKey, {
      kind: BOT_UPDATE_KINDS.CHOSEN_INLINE_RESULT,
    });
}

/**
 * Handles the `pre_checkout_query` update — Telegram's final confirmation before
 * a payment is charged (binds to `Telegraf.on('pre_checkout_query', …)`). The
 * bot **must** answer within 10 seconds with
 * {@link import('../telegram-bot.service').TelegramBotService.answerPreCheckoutQuery}
 * (or `ctx.answerPreCheckoutQuery`) or the payment is cancelled. Read the query
 * with {@link import('../param.decorators').PreCheckoutData}.
 *
 * @returns A method decorator recording the binding.
 * @throws Never.
 *
 * @example
 * ```ts
 * @PreCheckoutQuery()
 * onPreCheckout(@Ctx() ctx: Context) {
 *   return ctx.answerPreCheckoutQuery(true);
 * }
 * ```
 */
export function PreCheckoutQuery(): MethodDecorator {
  return (target, propertyKey) =>
    appendBinding(target, propertyKey, {
      kind: BOT_UPDATE_KINDS.PRE_CHECKOUT_QUERY,
    });
}

/**
 * Handles the `shipping_query` update — fired only for invoices sent with
 * `is_flexible: true`, when the user supplies a shipping address (binds to
 * `Telegraf.on('shipping_query', …)`). Reply with the available options via
 * {@link import('../telegram-bot.service').TelegramBotService.answerShippingQuery}
 * (or `ctx.answerShippingQuery`). Read the query with
 * {@link import('../param.decorators').ShippingData}.
 *
 * @returns A method decorator recording the binding.
 * @throws Never.
 *
 * @example
 * ```ts
 * @ShippingQuery()
 * onShipping(@Ctx() ctx: Context) {
 *   return ctx.answerShippingQuery(true, [
 *     { id: 'std', title: 'Standard', prices: [{ label: 'Shipping', amount: 500 }] },
 *   ]);
 * }
 * ```
 */
export function ShippingQuery(): MethodDecorator {
  return (target, propertyKey) =>
    appendBinding(target, propertyKey, {
      kind: BOT_UPDATE_KINDS.SHIPPING_QUERY,
    });
}

/**
 * Handles a successful payment — the `successful_payment` service message
 * delivered after the charge clears (binds to the `successful_payment` message
 * subtype via Telegraf's `message('successful_payment')` filter, the
 * non-deprecated path that survives Telegraf v5). This is where fulfilment
 * happens; the payload carries the `telegram_payment_charge_id` /
 * `provider_payment_charge_id` (never log them). Read it with
 * {@link import('../param.decorators').SuccessfulPaymentData}.
 *
 * @returns A method decorator recording the binding.
 * @throws Never.
 *
 * @example
 * ```ts
 * @SuccessfulPayment()
 * onPaid(@SuccessfulPaymentData() payment: Message.SuccessfulPaymentMessage['successful_payment']) {
 *   this.orders.fulfil(payment.invoice_payload);
 * }
 * ```
 */
export function SuccessfulPayment(): MethodDecorator {
  return (target, propertyKey) =>
    appendBinding(target, propertyKey, {
      kind: BOT_UPDATE_KINDS.SUCCESSFUL_PAYMENT,
    });
}
