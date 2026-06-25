/**
 * @file src/lib/bot/updates/execution/handler-dispatch.ts
 *
 * PURPOSE
 * -------
 * The single place that dispatches one Telegram update to a decorated handler —
 * resolving its injected arguments, running it through any guards / interceptors
 * / exception filters, and isolating errors so one failing handler never breaks
 * the update pipeline. Shared by **both** the top-level update registrar
 * (`@TelegramUpdate` handlers) and the scenes registrar (handlers inside a
 * `@Scene`/`@WizardScene`), so the two paths behave identically.
 *
 * Handlers with no enhancers take a fast path (a plain `apply` with isolation);
 * otherwise the call is threaded through
 * {@link import('./handler-execution').runWithEnhancers}.
 *
 * USAGE
 * -----
 * Internal to the registrars. Pure with respect to its inputs (target, context,
 * logger), so it is unit-testable without a running bot.
 *
 * KEY EXPORTS
 * -----------
 * - DispatchTarget: the resolved handler + metadata a single dispatch needs.
 * - dispatchToHandler: run one update through a handler and its enhancers.
 */

import { type Logger, type Type } from '@nestjs/common';
import type { Context } from 'telegraf';

import { resolveHandlerArguments } from '../argument-resolver';
import type {
  ParamMetadata,
  TelegramUpdateHandler,
} from '../telegram-update.types';
import type { ResolvedEnhancers } from './enhancer.types';
import { RUN_OUTCOMES, runWithEnhancers } from './handler-execution';
import { TelegramExecutionContext } from './telegram-execution-context';

/** Everything {@link dispatchToHandler} needs to invoke one handler. */
export interface DispatchTarget {
  /** The provider instance bound as `this`. */
  readonly instance: object;
  /** The provider class (for the execution context's `getClass`). */
  readonly metatype: Type;
  /** The method to invoke (the instance's resolved, override-aware method). */
  readonly handler: TelegramUpdateHandler;
  /**
   * The metadata-carrying function exposed via the execution context's
   * `getHandler()` (for `Reflector`-driven enhancers). Defaults to
   * {@link DispatchTarget.handler}; differs only for an overridden inherited
   * handler, where it is the base-prototype function.
   */
  readonly decorated?: TelegramUpdateHandler;
  /** The method's parameter descriptors (drives argument resolution). */
  readonly params: readonly ParamMetadata[];
  /** The handler's resolved guards / interceptors / filters. */
  readonly enhancers: ResolvedEnhancers;
  /** Human-readable identifier (`Class.method`) for diagnostics. */
  readonly label: string;
}

/**
 * Dispatches one update to a handler, isolating errors. Handlers without any
 * enhancers take the fast path (a plain `apply`); otherwise the call runs through
 * the guard / interceptor / filter pipeline. A guard denial is logged at debug
 * level; an unhandled error is logged at error level. Never rethrows — preserving
 * the "one failing handler never breaks the pipeline" guarantee.
 *
 * @param target - The resolved handler, its params, and its enhancers.
 * @param ctx - The Telegraf context for the current update.
 * @param logger - Logger used for the denial/error diagnostics.
 * @returns `true` if the handler completed (or a filter handled its error) so a
 *   `@Use` middleware chain may proceed; `false` if a guard denied it or it threw
 *   uncaught. Terminal handlers ignore this value.
 * @throws Never (handler/guard/interceptor errors are routed to filters, else logged).
 */
export async function dispatchToHandler(
  target: DispatchTarget,
  ctx: Context,
  logger: Logger,
): Promise<boolean> {
  const { instance, metatype, handler, decorated, params, enhancers, label } =
    target;

  // ── Fast path: nothing to wrap, behave exactly like a plain invoke. ─────────
  if (
    enhancers.guards.length === 0 &&
    enhancers.interceptors.length === 0 &&
    enhancers.filters.length === 0
  ) {
    try {
      await handler.apply(instance, resolveHandlerArguments(ctx, params));
      return true;
    } catch (error) {
      const reason = error instanceof Error ? error.message : String(error);
      logger.error(`Telegram handler ${label} threw: ${reason}`);
      return false;
    }
  }

  // ── getHandler() exposes the metadata-bearing function so Reflector-driven
  //    enhancers read the inherited method's metadata, not the override's. ──────
  const context = new TelegramExecutionContext(ctx, metatype, decorated ?? handler);
  try {
    const outcome = await runWithEnhancers({
      context,
      enhancers,
      handler: () =>
        handler.apply(instance, resolveHandlerArguments(ctx, params)),
    });
    if (outcome === RUN_OUTCOMES.DENIED) {
      logger.debug(`Telegram handler ${label} was blocked by a guard`);
      return false;
    }
    return true;
  } catch (error) {
    // ── No filter handled it: preserve the isolate-and-log guarantee. The
    //    update's @Use chain stops (returns false), but the process lives on. ──
    const reason = error instanceof Error ? error.message : String(error);
    logger.error(`Telegram handler ${label} threw: ${reason}`);
    return false;
  }
}
