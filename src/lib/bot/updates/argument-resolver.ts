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
  PARAM_KINDS,
  type ParamKind,
  type ParamMetadata,
} from './telegram-update.types';

/**
 * Resolves a single parameter's injected value from the update context.
 *
 * @param ctx - The Telegraf context for the current update.
 * @param kind - Which value to extract.
 * @returns The value to inject (may be `undefined` when absent on this update).
 * @throws Never.
 */
function resolveParam(ctx: Context, kind: ParamKind): unknown {
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
 * @returns The argument array to spread into the handler call.
 * @throws Never.
 */
export function resolveHandlerArguments(
  ctx: Context,
  params: readonly ParamMetadata[],
): unknown[] {
  if (params.length === 0) return [ctx];

  const size = params.reduce((max, param) => Math.max(max, param.index), 0) + 1;
  const args = new Array<unknown>(size).fill(undefined);
  for (const param of params) args[param.index] = resolveParam(ctx, param.kind);
  return args;
}
