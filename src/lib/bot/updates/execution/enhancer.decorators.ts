/**
 * @file src/lib/bot/updates/execution/enhancer.decorators.ts
 *
 * PURPOSE
 * -------
 * The `@UseTelegramGuards` / `@UseTelegramInterceptors` / `@UseTelegramFilters`
 * decorators that attach guards, interceptors, and exception filters to a
 * `@TelegramUpdate` provider — at the class level (applies to every handler) or
 * on an individual handler method. They are the Telegram-side analogues of Nest's
 * `@UseGuards` / `@UseInterceptors` / `@UseFilters`, recording their refs as
 * reflect-metadata for the registrar's resolver to read at bootstrap.
 *
 * USAGE
 * -----
 * ```ts
 * @TelegramUpdate()
 * @UseTelegramGuards(new ChatAllowlistGuard({ allow: [ADMIN_CHAT] }))
 * export class AdminUpdate {
 *   @Command('deploy')
 *   @UseTelegramInterceptors(LoggingInterceptor)   // class ref, resolved via DI
 *   onDeploy(@Ctx() ctx: Context) { ... }
 * }
 * ```
 *
 * KEY EXPORTS
 * -----------
 * - UseTelegramGuards: attach guard(s) to a class or handler.
 * - UseTelegramInterceptors: attach interceptor(s) to a class or handler.
 * - UseTelegramFilters: attach exception filter(s) to a class or handler.
 */

import 'reflect-metadata';

import {
  TELEGRAM_FILTERS_METADATA,
  TELEGRAM_GUARDS_METADATA,
  TELEGRAM_INTERCEPTORS_METADATA,
  type TelegramFilterRef,
  type TelegramGuardRef,
  type TelegramInterceptorRef,
} from './enhancer.types';

/**
 * Appends enhancer refs onto a decorator target, preserving any refs from other
 * (stacked) decorators on the same target.
 *
 * For a method decorator the metadata is attached to the method function itself —
 * the same reference the registrar later reads off the resolved instance. For a
 * class decorator (`propertyKey === undefined`) it is attached to the constructor.
 *
 * @param key - The reflect-metadata key for this enhancer kind.
 * @param target - The decorator `target` (prototype for methods, constructor for classes).
 * @param propertyKey - The method name, or `undefined` for a class decorator.
 * @param refs - The enhancer refs to append.
 * @returns Nothing.
 * @throws Never.
 */
function appendEnhancers<TRef>(
  key: string,
  target: object,
  propertyKey: string | symbol | undefined,
  refs: readonly TRef[],
): void {
  const metadataTarget =
    propertyKey === undefined
      ? target
      : ((target as Record<string | symbol, unknown>)[propertyKey] as
          object | undefined);
  if (!metadataTarget) return;

  const existing =
    (Reflect.getMetadata(key, metadataTarget) as TRef[] | undefined) ?? [];
  Reflect.defineMetadata(key, [...existing, ...refs], metadataTarget);
}

/**
 * Binds one or more guards to a `@TelegramUpdate` class or handler method. Each
 * guard's `canActivate` runs before the handler; the first to return a falsy
 * value blocks the update (the handler never runs).
 *
 * @param guards - Guard instances and/or guard classes (classes resolved via DI).
 * @returns A decorator usable on a class or a method.
 * @throws Never.
 *
 * @example
 * ```ts
 * @UseTelegramGuards(new RateLimitGuard({ capacity: 5, refillPerInterval: 5 }))
 * @Command('search') onSearch(@Ctx() ctx: Context) { ... }
 * ```
 */
export function UseTelegramGuards(
  ...guards: TelegramGuardRef[]
): ClassDecorator & MethodDecorator {
  return ((target: object, propertyKey?: string | symbol): void =>
    appendEnhancers(
      TELEGRAM_GUARDS_METADATA,
      target,
      propertyKey,
      guards,
    )) as ClassDecorator & MethodDecorator;
}

/**
 * Binds one or more interceptors to a `@TelegramUpdate` class or handler method.
 * Interceptors wrap handler execution (before/after, transform, short-circuit);
 * a class-level interceptor wraps method-level ones.
 *
 * @param interceptors - Interceptor instances and/or classes (resolved via DI).
 * @returns A decorator usable on a class or a method.
 * @throws Never.
 *
 * @example
 * ```ts
 * @UseTelegramInterceptors(TimingInterceptor)
 * @On('text') onText(@Ctx() ctx: Context) { ... }
 * ```
 */
export function UseTelegramInterceptors(
  ...interceptors: TelegramInterceptorRef[]
): ClassDecorator & MethodDecorator {
  return ((target: object, propertyKey?: string | symbol): void =>
    appendEnhancers(
      TELEGRAM_INTERCEPTORS_METADATA,
      target,
      propertyKey,
      interceptors,
    )) as ClassDecorator & MethodDecorator;
}

/**
 * Binds one or more exception filters to a `@TelegramUpdate` class or handler
 * method. When the guards, interceptors, or handler throw, the first filter whose
 * `@Catch(...)` types match the error handles it; a filter with no `@Catch` (or
 * `@Catch()`) catches everything. Method-level filters take precedence over
 * class-level ones.
 *
 * @param filters - Filter instances and/or filter classes (resolved via DI).
 * @returns A decorator usable on a class or a method.
 * @throws Never.
 *
 * @example
 * ```ts
 * @UseTelegramFilters(new TelegramExceptionFilter({ reply: 'Something went wrong.' }))
 * @Command('risky') onRisky(@Ctx() ctx: Context) { ... }
 * ```
 */
export function UseTelegramFilters(
  ...filters: TelegramFilterRef[]
): ClassDecorator & MethodDecorator {
  return ((target: object, propertyKey?: string | symbol): void =>
    appendEnhancers(
      TELEGRAM_FILTERS_METADATA,
      target,
      propertyKey,
      filters,
    )) as ClassDecorator & MethodDecorator;
}
