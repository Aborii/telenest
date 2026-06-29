/**
 * @file src/lib/bot/updates/execution/enhancer.types.ts
 *
 * PURPOSE
 * -------
 * Shared types and reflect-metadata keys for the Bot API "enhancer" system —
 * guards, interceptors, and exception filters bound onto `@TelegramUpdate`
 * handlers. The enhancer contracts are exactly NestJS's own (`CanActivate`,
 * `NestInterceptor`, `ExceptionFilter`); these aliases simply give them
 * Telegram-flavoured names and add the "ref" unions (an instance *or* a class to
 * resolve from the DI container) that the decorators accept.
 *
 * No `enum` is used — the metadata keys are plain string constants (see
 * CLAUDE.md).
 *
 * USAGE
 * -----
 * Internal to `src/lib/bot/updates/execution`; the public surface is the
 * `@UseTelegram*` decorators and the built-in guards/filter that build on these.
 *
 * KEY EXPORTS
 * -----------
 * - TelegramGuard / TelegramInterceptor / TelegramFilter: enhancer contracts.
 * - Telegram*Ref: an instance or class accepted by a `@UseTelegram*` decorator.
 * - ResolvedEnhancers / ResolvedExceptionFilter: the resolved, ready-to-run sets.
 * - TELEGRAM_*_METADATA: reflect-metadata keys the resolver reads.
 */

import type {
  CanActivate,
  ExceptionFilter,
  NestInterceptor,
  Type,
} from '@nestjs/common';

// ── Enhancer contracts (NestJS-native) ──────────────────────────────────────

/** A guard that decides whether an update handler may run (NestJS `CanActivate`). */
export type TelegramGuard = CanActivate;

/** An interceptor that wraps handler execution (NestJS `NestInterceptor`). */
export type TelegramInterceptor = NestInterceptor;

/** A filter that handles errors thrown while processing an update (NestJS `ExceptionFilter`). */
export type TelegramFilter = ExceptionFilter;

// ── Decorator argument unions ───────────────────────────────────────────────

/**
 * Either a ready guard instance or a guard class. A class is resolved from the
 * Nest container at bootstrap (register it as a provider); an instance is used
 * as-is (handy for configured built-ins, e.g. `new ChatAllowlistGuard(...)`).
 */
export type TelegramGuardRef = TelegramGuard | Type<TelegramGuard>;

/** Either a ready interceptor instance or an interceptor class to resolve via DI. */
export type TelegramInterceptorRef =
  TelegramInterceptor | Type<TelegramInterceptor>;

/** Either a ready filter instance or a filter class to resolve via DI. */
export type TelegramFilterRef = TelegramFilter | Type<TelegramFilter>;

// ── Exception matching ──────────────────────────────────────────────────────

/**
 * The shape of an exception class usable on the right-hand side of `instanceof`.
 * Constructor argument types are irrelevant for matching, hence `never[]`.
 */
export type ExceptionType = new (...args: never[]) => object;

/**
 * A resolved exception filter paired with the exception classes it handles.
 *
 * `catches` is `null` for a catch-all filter — one declared with `@Catch()` (no
 * arguments) or with no `@Catch()` at all. Otherwise it is the non-empty list of
 * classes from `@Catch(A, B, …)`; the filter runs only when the thrown error is
 * an `instanceof` one of them.
 */
export interface ResolvedExceptionFilter {
  /** The filter instance whose `catch()` is invoked. */
  readonly instance: TelegramFilter;
  /** Exception classes this filter handles, or `null` to handle everything. */
  readonly catches: readonly ExceptionType[] | null;
}

/**
 * The fully-resolved enhancer set for one handler, ready for the execution
 * pipeline. Guards and interceptors are ordered class-level first (so a
 * class-level interceptor is the outermost wrapper); filters are ordered
 * method-level first (the most specific matching filter wins).
 */
export interface ResolvedEnhancers {
  /** Guards run in order; the first to deny short-circuits the handler. */
  readonly guards: readonly TelegramGuard[];
  /** Interceptors wrapping the handler; index 0 is the outermost. */
  readonly interceptors: readonly TelegramInterceptor[];
  /** Candidate filters, searched in order for the first whose `catches` match. */
  readonly filters: readonly ResolvedExceptionFilter[];
}

// ── Reflect-metadata keys ───────────────────────────────────────────────────

/** Holds the `TelegramGuardRef[]` attached by `@UseTelegramGuards`. */
export const TELEGRAM_GUARDS_METADATA = 'nestjs-telegram:guards';

/** Holds the `TelegramInterceptorRef[]` attached by `@UseTelegramInterceptors`. */
export const TELEGRAM_INTERCEPTORS_METADATA = 'nestjs-telegram:interceptors';

/** Holds the `TelegramFilterRef[]` attached by `@UseTelegramFilters`. */
export const TELEGRAM_FILTERS_METADATA = 'nestjs-telegram:exception-filters';

/**
 * The metadata key NestJS's `@Catch(...)` writes the handled exception classes
 * under. Read defensively (best-effort) so a standard `@Catch(MyError)` on a
 * Telegram filter narrows which errors it handles; absent ⇒ catch-all.
 */
export const FILTER_CATCH_EXCEPTIONS_METADATA = '__filterCatchExceptions__';
