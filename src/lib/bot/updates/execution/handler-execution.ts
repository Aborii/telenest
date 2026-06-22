/**
 * @file src/lib/bot/updates/execution/handler-execution.ts
 *
 * PURPOSE
 * -------
 * The execution pipeline that runs one decorated handler through its resolved
 * guards, interceptors, and exception filters — the Telegram-side equivalent of
 * how Nest threads an HTTP request through the same primitives:
 *
 *   guards → interceptors (wrap) → handler → exception filters (on error)
 *
 * A guard that denies short-circuits silently (the handler never runs). An error
 * thrown anywhere in the chain is routed to the first matching exception filter;
 * if none matches, the error is re-thrown so the registrar can log it (preserving
 * the "one failing handler never breaks the pipeline" guarantee).
 *
 * USAGE
 * -----
 * Internal to the registrar. Pure with respect to its inputs (the context, the
 * resolved enhancers, and the handler thunk), so it is unit-testable without a
 * running bot.
 *
 * KEY EXPORTS
 * -----------
 * - RUN_OUTCOMES / RunOutcome: whether the handler completed or was denied.
 * - runWithEnhancers: execute one handler through its enhancer chain.
 */

import type { CallHandler } from '@nestjs/common';
import {
  defer,
  from,
  isObservable,
  lastValueFrom,
  mergeMap,
  type Observable,
} from 'rxjs';
import type {
  ExceptionType,
  ResolvedEnhancers,
  ResolvedExceptionFilter,
  TelegramGuard,
  TelegramInterceptor,
} from './enhancer.types';
import type { TelegramExecutionContext } from './telegram-execution-context';

/**
 * Closed set of outcomes from {@link runWithEnhancers} (no `enum`, per CLAUDE.md).
 */
export const RUN_OUTCOMES = {
  /** The handler ran (or a thrown error was handled by a filter). */
  COMPLETED: 'completed',
  /** A guard denied the update; the handler did not run. */
  DENIED: 'denied',
} as const;

/** A single run outcome (the value side of {@link RUN_OUTCOMES}). */
export type RunOutcome = (typeof RUN_OUTCOMES)[keyof typeof RUN_OUTCOMES];

/**
 * The actual handler call, with its arguments already resolved. Returning a value
 * or a promise is fine; the value is unused (Telegram has no response to send).
 */
export type HandlerThunk = () => unknown | Promise<unknown>;

/** Inputs for a single enhancer-wrapped handler invocation. */
export interface EnhancerExecution {
  /** Execution context handed to every guard/interceptor/filter. */
  readonly context: TelegramExecutionContext;
  /** The resolved guards, interceptors, and filters for this handler. */
  readonly enhancers: ResolvedEnhancers;
  /** Runs the decorated method with its resolved arguments. */
  readonly handler: HandlerThunk;
}

/**
 * Runs a handler through its guards, interceptors, and exception filters.
 *
 * @param execution - The context, resolved enhancers, and handler thunk.
 * @returns `COMPLETED` if the handler ran (or its error was handled by a filter),
 *   or `DENIED` if a guard blocked the update.
 * @throws Whatever the handler/guards/interceptors throw, **only** when no
 *   configured filter handles it (so the caller can log it as today).
 */
export async function runWithEnhancers(
  execution: EnhancerExecution,
): Promise<RunOutcome> {
  const { context, enhancers, handler } = execution;
  try {
    // ── Guards: first denial short-circuits before any interceptor/handler. ──
    for (const guard of enhancers.guards) {
      const allowed = await resolveCanActivate(guard, context);
      if (!allowed) return RUN_OUTCOMES.DENIED;
    }

    // ── Interceptors wrap the handler; with none, the handler runs directly. ──
    await runInterceptors(context, enhancers.interceptors, handler);
    return RUN_OUTCOMES.COMPLETED;
  } catch (error) {
    // ── Route the error to the first matching filter, else let it propagate. ──
    const filter = selectFilter(enhancers.filters, error);
    if (!filter) throw error;
    await filter.instance.catch(error, context);
    return RUN_OUTCOMES.COMPLETED;
  }
}

/**
 * Normalizes a guard's `canActivate` result (boolean / promise / observable) to a
 * single boolean.
 *
 * @param guard - The guard to evaluate.
 * @param context - The execution context for the current update.
 * @returns `true` to allow the handler, `false` to block it.
 * @throws Re-throws whatever the guard throws (routed to filters by the caller).
 */
async function resolveCanActivate(
  guard: TelegramGuard,
  context: TelegramExecutionContext,
): Promise<boolean> {
  const result = guard.canActivate(context);
  if (typeof result === 'boolean') return result;
  if (isObservable(result))
    return Boolean(await lastValueFrom(result, { defaultValue: false }));
  return Boolean(await result);
}

/**
 * Builds and runs the interceptor chain around the handler. Each interceptor's
 * `intercept(context, next)` may run logic before/after, transform, or
 * short-circuit by not calling `next.handle()`. The handler itself is deferred so
 * it only runs when the chain is subscribed (after every interceptor's pre-work).
 *
 * @param context - The execution context for the current update.
 * @param interceptors - Interceptors, outermost first.
 * @param handler - The handler thunk to run at the centre of the chain.
 * @returns Resolves once the chain settles.
 * @throws Re-throws whatever the handler/interceptors throw.
 */
async function runInterceptors(
  context: TelegramExecutionContext,
  interceptors: readonly TelegramInterceptor[],
  handler: HandlerThunk,
): Promise<void> {
  if (interceptors.length === 0) {
    await handler();
    return;
  }

  // ── Centre of the chain: defer so the handler runs on subscription only. ──
  const base: CallHandler<unknown> = {
    handle: (): Observable<unknown> =>
      defer(() => from(Promise.resolve(handler()))),
  };

  // ── Fold right so interceptor[0] becomes the outermost wrapper. ──
  const chain = interceptors.reduceRight<CallHandler<unknown>>(
    (next, interceptor) => ({
      handle: (): Observable<unknown> =>
        // `intercept` may return an Observable or a Promise<Observable>; resolve
        // either, then flatten into the inner stream.
        from(Promise.resolve(interceptor.intercept(context, next))).pipe(
          mergeMap((stream: Observable<unknown>) => stream),
        ),
    }),
    base,
  );

  await lastValueFrom(chain.handle(), { defaultValue: undefined });
}

/**
 * Picks the first filter that handles `error` — a catch-all (`catches === null`)
 * or one whose `@Catch` types the error is an instance of.
 *
 * @param filters - Candidate filters, most specific first.
 * @param error - The thrown value.
 * @returns The matching filter, or `undefined` when none applies.
 * @throws Never.
 */
function selectFilter(
  filters: readonly ResolvedExceptionFilter[],
  error: unknown,
): ResolvedExceptionFilter | undefined {
  for (const filter of filters) {
    if (filter.catches === null) return filter;
    if (matchesException(error, filter.catches)) return filter;
  }
  return undefined;
}

/**
 * Tests whether `error` is an instance of any of the given exception classes.
 *
 * @param error - The thrown value (narrowed to an object before `instanceof`).
 * @param types - The exception classes a filter declared via `@Catch(...)`.
 * @returns `true` when `error instanceof` one of `types`.
 * @throws Never.
 */
function matchesException(
  error: unknown,
  types: readonly ExceptionType[],
): boolean {
  if (typeof error !== 'object' || error === null) return false;
  return types.some((type) => error instanceof type);
}
