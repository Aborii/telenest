/**
 * @file src/lib/bot/updates/execution/telegram-execution-context.ts
 *
 * PURPOSE
 * -------
 * Adapts a Telegraf {@link Context} into a NestJS {@link ExecutionContext} so the
 * standard cross-cutting primitives — `CanActivate` (guards), `NestInterceptor`
 * (interceptors), and `ExceptionFilter` (filters) — can be written against a
 * Telegram update exactly the way they are for HTTP requests. The update's
 * {@link Context} is exposed through {@link TelegramExecutionContext.getContext},
 * while {@link TelegramExecutionContext.getHandler} / `getClass` expose the
 * decorated method and its provider class for `Reflector`-driven metadata reads.
 *
 * USAGE
 * -----
 * Inside a guard / interceptor / filter, recover the Telegraf context with the
 * static {@link TelegramExecutionContext.create} helper:
 *
 * ```ts
 * canActivate(context: ExecutionContext): boolean {
 *   const ctx = TelegramExecutionContext.create(context).getContext();
 *   return ctx.from?.id === MY_ADMIN_ID;
 * }
 * ```
 *
 * KEY EXPORTS
 * -----------
 * - TELEGRAM_CONTEXT_TYPE: the `getType()` discriminator for Telegram updates.
 * - TelegramExecutionContext: the `ExecutionContext` adapter over an update.
 */

import type { ArgumentsHost, ExecutionContext, Type } from '@nestjs/common';
import type { Context } from 'telegraf';
import type { TelegramUpdateHandler } from '../telegram-update.types';

// ── The per-transport host types are not re-exported from the package root, so
//    derive them straight from the ArgumentsHost interface (stays in lock-step
//    with the installed @nestjs/common, no deep-subpath import needed). ────────
/** The host returned by `ArgumentsHost.switchToHttp`. */
type HttpArgumentsHost = ReturnType<ArgumentsHost['switchToHttp']>;
/** The host returned by `ArgumentsHost.switchToRpc`. */
type RpcArgumentsHost = ReturnType<ArgumentsHost['switchToRpc']>;
/** The host returned by `ArgumentsHost.switchToWs`. */
type WsArgumentsHost = ReturnType<ArgumentsHost['switchToWs']>;

/**
 * The value returned by {@link TelegramExecutionContext.getType}. Mirrors the
 * `'http' | 'rpc' | 'ws'` discriminators Nest uses for its built-in transports so
 * enhancers can branch on `host.getType() === TELEGRAM_CONTEXT_TYPE`.
 */
export const TELEGRAM_CONTEXT_TYPE = 'telegram' as const;

/** The literal type of {@link TELEGRAM_CONTEXT_TYPE}. */
export type TelegramContextType = typeof TELEGRAM_CONTEXT_TYPE;

/**
 * Placeholder class returned by {@link TelegramExecutionContext.getClass} when a
 * context is reconstructed from a bare {@link ArgumentsHost} that cannot supply
 * the originating provider class (e.g. a hand-rolled host in a unit test).
 */
class UnknownTelegramHandlerHost {}

/** No-op stand-in returned by `getHandler()` when the real method is unknown. */
const UNKNOWN_HANDLER: TelegramUpdateHandler = () => undefined;

/**
 * A NestJS {@link ExecutionContext} backed by a single Telegram update.
 *
 * The Bot API has no request/response pair, so the three `switchTo*` accessors
 * (`switchToHttp` / `switchToRpc` / `switchToWs`) are not meaningful and throw;
 * use {@link TelegramExecutionContext.getContext} to reach the update instead.
 * The update {@link Context} is the sole "argument" of the handler, so it is what
 * `getArgs()` / `getArgByIndex(0)` return.
 */
export class TelegramExecutionContext implements ExecutionContext {
  /**
   * @param _ctx - The Telegraf context for the current update.
   * @param _class - The `@TelegramUpdate` provider class the handler lives on.
   * @param _handler - The decorated handler method being dispatched.
   */
  public constructor(
    private readonly _ctx: Context,
    private readonly _class: Type,
    private readonly _handler: TelegramUpdateHandler,
  ) {}

  /**
   * Re-wraps an arbitrary {@link ArgumentsHost} as a `TelegramExecutionContext`.
   *
   * The registrar always passes a real `TelegramExecutionContext`, so the common
   * case is a cheap identity return. When called with a different host (or a
   * minimal test double), the Telegraf context is read from argument slot 0 and
   * the provider class / handler are taken from the host when it exposes them.
   *
   * @param host - The execution context or arguments host to adapt.
   * @returns A `TelegramExecutionContext` exposing the update's `Context`.
   * @throws Never.
   *
   * @example
   * ```ts
   * const ctx = TelegramExecutionContext.create(host).getContext();
   * ```
   */
  public static create(host: ArgumentsHost): TelegramExecutionContext {
    // ── Already the right shape: avoid rebuilding and preserve class/handler. ──
    if (host instanceof TelegramExecutionContext) return host;

    const ctx = host.getArgByIndex<Context>(0);
    // ── A bare ArgumentsHost lacks getClass/getHandler; feature-detect them. ───
    const maybe = host as Partial<ExecutionContext>;
    const cls =
      typeof maybe.getClass === 'function'
        ? maybe.getClass()
        : UnknownTelegramHandlerHost;
    const handler =
      typeof maybe.getHandler === 'function'
        ? (maybe.getHandler() as TelegramUpdateHandler)
        : UNKNOWN_HANDLER;
    return new TelegramExecutionContext(ctx, cls, handler);
  }

  /**
   * The Telegraf {@link Context} for the current update.
   *
   * @returns The update context, optionally narrowed to a custom context type.
   * @throws Never.
   */
  public getContext<TContext extends Context = Context>(): TContext {
    // ── Caller-chosen narrowing; the stored value is always a Context. ─────────
    return this._ctx as TContext;
  }

  /**
   * The handler arguments. The Telegraf `Context` is the only argument, so this
   * is always a one-element tuple.
   *
   * @returns A single-element array holding the update `Context`.
   * @throws Never.
   */
  public getArgs<T extends readonly unknown[] = readonly unknown[]>(): T {
    return [this._ctx] as unknown as T;
  }

  /**
   * The handler argument at `index`. Index `0` is the update `Context`; any other
   * index is `undefined`.
   *
   * @param index - Zero-based argument position.
   * @returns The argument at that position (the `Context` at 0, else `undefined`).
   * @throws Never.
   */
  public getArgByIndex<T = unknown>(index: number): T {
    const args: readonly unknown[] = [this._ctx];
    return args[index] as T;
  }

  /**
   * Not supported — a Telegram update has no HTTP request/response pair.
   *
   * @returns Never returns.
   * @throws Always; use {@link TelegramExecutionContext.getContext} instead.
   */
  public switchToHttp(): HttpArgumentsHost {
    throw new Error(
      'TelegramExecutionContext has no HTTP host. Use getContext() to access the Telegraf Context.',
    );
  }

  /**
   * Not supported — a Telegram update is not an RPC message.
   *
   * @returns Never returns.
   * @throws Always; use {@link TelegramExecutionContext.getContext} instead.
   */
  public switchToRpc(): RpcArgumentsHost {
    throw new Error(
      'TelegramExecutionContext has no RPC host. Use getContext() to access the Telegraf Context.',
    );
  }

  /**
   * Not supported — a Telegram update is not a WebSocket frame.
   *
   * @returns Never returns.
   * @throws Always; use {@link TelegramExecutionContext.getContext} instead.
   */
  public switchToWs(): WsArgumentsHost {
    throw new Error(
      'TelegramExecutionContext has no WS host. Use getContext() to access the Telegraf Context.',
    );
  }

  /**
   * The context discriminator, always {@link TELEGRAM_CONTEXT_TYPE}.
   *
   * @returns The string `'telegram'`.
   * @throws Never.
   */
  public getType<TContext extends string = TelegramContextType>(): TContext {
    // ── Caller may widen the literal; the runtime value is always 'telegram'. ──
    return TELEGRAM_CONTEXT_TYPE as TContext;
  }

  /**
   * The `@TelegramUpdate` provider class the dispatched handler belongs to.
   * Pair with `Reflector` to read class-level metadata.
   *
   * @returns The provider class.
   * @throws Never.
   */
  public getClass<T = unknown>(): Type<T> {
    return this._class as Type<T>;
  }

  /**
   * The decorated handler method being dispatched. Pair with `Reflector` to read
   * method-level metadata.
   *
   * @returns The handler function.
   * @throws Never.
   */
  // eslint-disable-next-line @typescript-eslint/ban-types -- ExecutionContext.getHandler is typed as Function by Nest.
  public getHandler(): Function {
    return this._handler;
  }
}
