/**
 * @file src/lib/bot/updates/argument-resolver.ts
 *
 * PURPOSE
 * -------
 * Turns a Telegraf {@link Context} plus a handler's recorded
 * {@link ParamMetadata} into the positional argument array passed to the
 * decorated method. Pure and side-effect-free, so it is trivially unit-testable
 * without a running bot.
 *
 * USAGE
 * -----
 * Internal to the registrar.
 *
 * KEY EXPORTS
 * -----------
 * - resolveHandlerArguments: builds the argument array for one invocation.
 */

import type { Context } from 'telegraf';

import {
  decodeCallbackAction,
  type CallbackActionSchema,
} from '../callback-action.codec';
import {
  PARAM_KINDS,
  type ParamKind,
  type ParamMetadata,
} from './telegram-update.types';

/**
 * Resolves a single parameter's injected value from the update context.
 *
 * @param ctx - The Telegraf context for the current update.
 * @param kind - Which value to extract.
 * @param callbackActionSchema - The matched `@CallbackAction`'s payload validator,
 *   when one was declared; used only by the `CALLBACK_PAYLOAD` kind to validate the
 *   decoded payload before injection.
 * @returns The value to inject (may be `undefined` when absent on this update).
 * @throws Whatever `callbackActionSchema` throws for an invalid payload (only for
 *   the `CALLBACK_PAYLOAD` kind); every other kind never throws.
 */
function resolveParam(
  ctx: Context,
  kind: ParamKind,
  callbackActionSchema?: CallbackActionSchema<unknown>,
): unknown {
  switch (kind) {
    case PARAM_KINDS.CONTEXT:
      return ctx;
    case PARAM_KINDS.MESSAGE_TEXT:
      return ctx.text;
    case PARAM_KINDS.SENDER:
      return ctx.from;
    case PARAM_KINDS.CALLBACK_DATA: {
      // ── `data` only exists on a data-bearing callback query; narrow first. ──
      const query = ctx.callbackQuery;
      return query && 'data' in query ? query.data : undefined;
    }
    case PARAM_KINDS.CALLBACK_PAYLOAD: {
      // ── Decode the `{ a, d? }` envelope off the callback data; a non-envelope
      //    (or non-callback update) injects `undefined`. When the matched action
      //    declared a schema, validate the payload through it — a throw here is
      //    caught by the dispatch pipeline and routed to exception filters. ─────
      const query = ctx.callbackQuery;
      const data = query && 'data' in query ? query.data : undefined;
      const decoded =
        typeof data === 'string' ? decodeCallbackAction(data) : null;
      const payload = decoded?.payload;
      return callbackActionSchema ? callbackActionSchema(payload) : payload;
    }
    case PARAM_KINDS.INLINE_QUERY_TEXT:
      // ── `inlineQuery` is undefined on non-inline updates; optional-chain it. ─
      return ctx.inlineQuery?.query;
    case PARAM_KINDS.INLINE_QUERY_OFFSET:
      return ctx.inlineQuery?.offset;
    default: {
      // ── Exhaustiveness guard: a new ParamKind without a case fails to build. ─
      const exhaustive: never = kind;
      return exhaustive;
    }
  }
}

/**
 * Builds the positional arguments for a decorated handler invocation.
 *
 * When the method declares no parameter decorators, the raw `Context` is passed
 * as the single argument (the common `(ctx) => …` ergonomic). Otherwise an array
 * sized to the highest decorated index is produced; decorated slots receive
 * their resolved value and any gap stays `undefined`.
 *
 * @param ctx - The Telegraf context for the current update.
 * @param params - The method's recorded parameter descriptors (any order).
 * @param callbackActionSchema - The matched `@CallbackAction`'s payload validator,
 *   when one was declared; applied to any `@CallbackPayload()` parameter.
 * @returns The argument array to spread into the handler call.
 * @throws Whatever `callbackActionSchema` throws for an invalid payload when a
 *   `@CallbackPayload()` parameter is present; otherwise never throws.
 */
export function resolveHandlerArguments(
  ctx: Context,
  params: readonly ParamMetadata[],
  callbackActionSchema?: CallbackActionSchema<unknown>,
): unknown[] {
  if (params.length === 0) return [ctx];

  const size = params.reduce((max, param) => Math.max(max, param.index), 0) + 1;
  const args = new Array<unknown>(size).fill(undefined);
  for (const param of params)
    args[param.index] = resolveParam(ctx, param.kind, callbackActionSchema);
  return args;
}
