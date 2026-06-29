/**
 * @file src/lib/bot/updates/param.decorators.ts
 *
 * PURPOSE
 * -------
 * Parameter decorators for `@TelegramUpdate` handler methods. Each records, in
 * reflect-metadata, which value the argument resolver should inject at a given
 * parameter position when an update fires.
 *
 * USAGE
 * -----
 * ```ts
 * @On('text')
 * onText(@MessageText() text: string | undefined, @Sender() from: User | undefined) { ... }
 * ```
 *
 * KEY EXPORTS
 * -----------
 * - Ctx: inject the raw Telegraf `Context`.
 * - MessageText: inject the incoming message text (or `undefined`).
 * - Sender: inject the triggering `User` (`ctx.from`, or `undefined`).
 * - CallbackData: inject a callback query's `data` string (or `undefined`).
 * - CallbackPayload: inject a decoded callback-action payload (or `undefined`).
 * - InlineQueryText: inject an inline query's text (or `undefined`).
 * - InlineQueryOffset: inject an inline query's offset (or `undefined`).
 * - PreCheckoutData: inject a pre-checkout query (or `undefined`).
 * - ShippingData: inject a shipping query (or `undefined`).
 * - SuccessfulPaymentData: inject a successful-payment payload (or `undefined`).
 */

import 'reflect-metadata';

import {
  PARAM_KINDS,
  UPDATE_PARAMS_METADATA,
  type ParamKind,
  type ParamMetadata,
} from './telegram-update.types';

/**
 * Records a parameter-injection descriptor on the handler method, preserving any
 * descriptors added by sibling parameter decorators.
 *
 * @param target - The prototype carrying the method (decorator `target`).
 * @param propertyKey - The decorated method's name (`undefined` for constructor
 *   parameters, which are not supported and ignored).
 * @param index - Zero-based parameter position.
 * @param kind - What the resolver should inject at that position.
 * @returns Nothing.
 * @throws Never.
 */
function appendParam(
  target: object,
  propertyKey: string | symbol | undefined,
  index: number,
  kind: ParamKind,
): void {
  if (propertyKey === undefined) return;

  const method = (target as Record<string | symbol, unknown>)[propertyKey] as
    object | undefined;
  if (!method) return;

  const existing =
    (Reflect.getMetadata(UPDATE_PARAMS_METADATA, method) as
      ParamMetadata[] | undefined) ?? [];
  Reflect.defineMetadata(
    UPDATE_PARAMS_METADATA,
    [...existing, { index, kind }],
    method,
  );
}

/**
 * Injects the raw Telegraf `Context` for the current update.
 *
 * @returns A parameter decorator.
 * @throws Never.
 */
export function Ctx(): ParameterDecorator {
  return (target, propertyKey, index) =>
    appendParam(target, propertyKey, index, PARAM_KINDS.CONTEXT);
}

/**
 * Injects the incoming message text (`ctx.text`), or `undefined` when the update
 * carries no text.
 *
 * @returns A parameter decorator.
 * @throws Never.
 */
export function MessageText(): ParameterDecorator {
  return (target, propertyKey, index) =>
    appendParam(target, propertyKey, index, PARAM_KINDS.MESSAGE_TEXT);
}

/**
 * Injects the `User` who triggered the update (`ctx.from`), or `undefined`.
 *
 * @returns A parameter decorator.
 * @throws Never.
 */
export function Sender(): ParameterDecorator {
  return (target, propertyKey, index) =>
    appendParam(target, propertyKey, index, PARAM_KINDS.SENDER);
}

/**
 * Injects the `data` string of a callback query (button press), or `undefined`
 * when the update is not a data-bearing callback query.
 *
 * @returns A parameter decorator.
 * @throws Never.
 */
export function CallbackData(): ParameterDecorator {
  return (target, propertyKey, index) =>
    appendParam(target, propertyKey, index, PARAM_KINDS.CALLBACK_DATA);
}

/**
 * Injects the decoded payload (the envelope's `d` field) of a callback-action
 * query, or `undefined` when the callback data carries no payload. Pair with
 * {@link import('./telegram-update.decorator').CallbackAction}: when that
 * decorator was given a schema, the value injected here is the schema's validated
 * result (a validation error is routed to the handler's exception filters);
 * without a schema the raw decoded payload is injected as `unknown`.
 *
 * Annotate the parameter with the type your schema guarantees — the decorator
 * cannot widen or narrow the declared parameter type for you.
 *
 * @returns A parameter decorator.
 * @throws Never.
 *
 * @example
 * ```ts
 * @CallbackAction('page', (v): { n: number } => v as { n: number })
 * onPage(@CallbackPayload() payload: { n: number }) { ... }
 * ```
 */
export function CallbackPayload(): ParameterDecorator {
  return (target, propertyKey, index) =>
    appendParam(target, propertyKey, index, PARAM_KINDS.CALLBACK_PAYLOAD);
}

/**
 * Injects the text of an inline query (`ctx.inlineQuery.query`), or `undefined`
 * when the update is not an inline query. Pair with `@InlineQuery()`.
 *
 * @returns A parameter decorator.
 * @throws Never.
 */
export function InlineQueryText(): ParameterDecorator {
  return (target, propertyKey, index) =>
    appendParam(target, propertyKey, index, PARAM_KINDS.INLINE_QUERY_TEXT);
}

/**
 * Injects the pagination offset of an inline query (`ctx.inlineQuery.offset`),
 * or `undefined` when the update is not an inline query. The offset is a
 * bot-defined string (empty for the first page); echo a non-empty value in the
 * answer's `next_offset` to paginate. Pair with `@InlineQuery()`.
 *
 * @returns A parameter decorator.
 * @throws Never.
 */
export function InlineQueryOffset(): ParameterDecorator {
  return (target, propertyKey, index) =>
    appendParam(target, propertyKey, index, PARAM_KINDS.INLINE_QUERY_OFFSET);
}

/**
 * Injects the pre-checkout query (`ctx.preCheckoutQuery`) — the user, currency,
 * total amount, and `invoice_payload` to validate before charging — or
 * `undefined` when the update is not a pre-checkout query. Pair with
 * `@PreCheckoutQuery()`.
 *
 * @returns A parameter decorator.
 * @throws Never.
 */
export function PreCheckoutData(): ParameterDecorator {
  return (target, propertyKey, index) =>
    appendParam(target, propertyKey, index, PARAM_KINDS.PRE_CHECKOUT_QUERY);
}

/**
 * Injects the shipping query (`ctx.shippingQuery`) — the user, `invoice_payload`,
 * and the requested `shipping_address` — or `undefined` when the update is not a
 * shipping query. Pair with `@ShippingQuery()`.
 *
 * @returns A parameter decorator.
 * @throws Never.
 */
export function ShippingData(): ParameterDecorator {
  return (target, propertyKey, index) =>
    appendParam(target, propertyKey, index, PARAM_KINDS.SHIPPING_QUERY);
}

/**
 * Injects the successful-payment payload (`ctx.message.successful_payment`) —
 * currency, total, `invoice_payload`, and the charge ids used for fulfilment and
 * refunds — or `undefined` when the message carries none. Never log the charge
 * ids. Pair with `@SuccessfulPayment()`.
 *
 * @returns A parameter decorator.
 * @throws Never.
 */
export function SuccessfulPaymentData(): ParameterDecorator {
  return (target, propertyKey, index) =>
    appendParam(target, propertyKey, index, PARAM_KINDS.SUCCESSFUL_PAYMENT);
}
