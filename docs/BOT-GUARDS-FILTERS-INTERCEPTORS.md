# Bot API Guards, Interceptors & Exception Filters

NestJS-native **guards**, **interceptors**, and **exception filters** for Telegram
Bot API updates. Compose cross-cutting concerns — authorization, rate limiting,
logging/timing, and error handling — around your `@TelegramUpdate` handlers
exactly the way you would around HTTP routes, using the same `CanActivate`,
`NestInterceptor`, and `ExceptionFilter` contracts you already know.

> **Builds on the decorator system.** These enhancers attach to the
> `@TelegramUpdate` handler classes documented in
> [BOT-UPDATE-DECORATORS.md](./BOT-UPDATE-DECORATORS.md). They are **Bot API
> only** and unrelated to the MTProto user-account side.

---

## Table of contents

- [Architecture overview](#architecture-overview)
- [File structure](#file-structure)
- [Quick start](#quick-start)
- [Guards](#guards)
- [Interceptors](#interceptors)
- [Exception filters](#exception-filters)
- [Execution order](#execution-order)
- [Instances vs class refs (DI)](#instances-vs-class-refs-di)
- [The execution context](#the-execution-context)
- [Behaviour notes & edge cases](#behaviour-notes--edge-cases)
- [Environment variables](#environment-variables)
- [Security notes](#security-notes)
- [How to extend](#how-to-extend)

---

## Architecture overview

Three decorators record which enhancers apply to a handler (or a whole update
class); the registrar resolves them at bootstrap and runs each update through them:

1. **Decorators** — `@UseTelegramGuards`, `@UseTelegramInterceptors`,
   `@UseTelegramFilters` store their refs as reflect-metadata, on the class
   (applies to every handler) or on an individual method.
2. **The resolver** (`TelegramEnhancerResolver`) reads that metadata at bootstrap,
   turns each ref into an instance — a passed instance is used directly; a class
   is resolved from the Nest DI container — and reads each filter's `@Catch(...)`
   types.
3. **The execution context** (`TelegramExecutionContext`) adapts the Telegraf
   `Context` to a NestJS `ExecutionContext`, so standard enhancers work unchanged.
4. **The pipeline** (`runWithEnhancers`) runs, per update:
   **guards → interceptors (wrap) → handler → exception filters (on error)**.

The registrar (`TelegramBotUpdatesRegistrar`) is the single binding point: it
already wraps every decorated method, so enhancers slot in without changing your
handlers. Handlers with **no** enhancers keep the original fast path.

```text
@TelegramUpdate class
  ├─ @UseTelegramGuards(...) / @UseTelegramInterceptors(...) / @UseTelegramFilters(...)
  │        └──(write metadata)──► reflect-metadata
  │
TelegramBotUpdatesRegistrar (onModuleInit)
  └─ for each handler:
       TelegramEnhancerResolver.resolve(class, method)
         ├─ instance ref ─► used as-is
         ├─ class ref    ─► ModuleRef.get(...)  (DI)
         └─ filter @Catch ─► handled exception types
                                   │
update arrives ──► registrar dispatch ──► runWithEnhancers
   guards.canActivate()  ── false ─► stop (handler never runs)
        │ all true
   interceptors.intercept(ctx, next)  (outermost first)
        │
   handler(...resolved args)
        │ throws?
   exception filter.catch(error, ctx)   (first match; else logged)
```

## File structure

```text
src/lib/bot/updates/
  execution/
    telegram-execution-context.ts     # TelegramExecutionContext (ExecutionContext over a Context)
    enhancer.types.ts                  # contracts, ref unions, metadata keys, resolved shapes
    enhancer.decorators.ts             # @UseTelegramGuards / @UseTelegramInterceptors / @UseTelegramFilters
    telegram-enhancer.resolver.ts      # resolves refs → instances (DI) and reads @Catch
    handler-execution.ts               # runWithEnhancers: guards → interceptors → handler → filters
    index.ts
  guards/
    chat-allowlist.guard.ts            # ChatAllowlistGuard
    user-allowlist.guard.ts            # UserAllowlistGuard
    rate-limit.guard.ts                # RateLimitGuard (per-key token bucket)
    index.ts
  filters/
    telegram-exception.filter.ts       # TelegramExceptionFilter (default catch-all)
    index.ts
```

Everything is re-exported from the package root (`nestjs-telegram`) and the
`nestjs-telegram/bot` subpath. The `TelegramEnhancerResolver` provider is wired
into `TelegramBotModule` automatically — no extra setup.

## Quick start

```ts
import { Injectable, Module } from '@nestjs/common';
import type { Context } from 'telegraf';
import {
  TelegramBotModule,
  TelegramUpdate,
  Command,
  Ctx,
  UseTelegramGuards,
  UseTelegramFilters,
  ChatAllowlistGuard,
  RateLimitGuard,
  TelegramExceptionFilter,
} from 'nestjs-telegram';

@TelegramUpdate()
// Class-level: every handler below is restricted to one support chat
// and replies politely if anything throws.
@UseTelegramGuards(new ChatAllowlistGuard({ allow: [Number(process.env.SUPPORT_CHAT)] }))
@UseTelegramFilters(new TelegramExceptionFilter({ reply: 'Sorry — something went wrong.' }))
@Injectable()
export class SupportUpdate {
  @Command('search')
  // Method-level: additionally throttle this command per chat.
  @UseTelegramGuards(new RateLimitGuard({ capacity: 3, refillPerInterval: 1 }))
  async onSearch(@Ctx() ctx: Context) {
    await ctx.reply('Searching…');
  }
}

@Module({
  imports: [TelegramBotModule.forRoot({ token: process.env.BOT_TOKEN! })],
  providers: [SupportUpdate],
})
export class AppModule {}
```

## Guards

A guard is a NestJS `CanActivate`: `canActivate(context)` returns `boolean`,
`Promise<boolean>`, or `Observable<boolean>`. Returning a falsy value **blocks**
the update — the handler never runs (and interceptors are skipped). A guard that
*throws* is routed to the exception filters.

Recover the Telegraf context inside a guard via
`TelegramExecutionContext.create(context).getContext()`.

### Built-in guards

| Guard | Allows when | Key options |
| --- | --- | --- |
| `ChatAllowlistGuard` | `ctx.chat.id` ∈ `allow` | `allow`, `allowWhenNoChat` |
| `UserAllowlistGuard` | `ctx.from.id` ∈ `allow` | `allow`, `allowWhenNoSender` |
| `RateLimitGuard` | a token is available for the key | `capacity`, `refillPerInterval`, `intervalMs`, `key`, `allowWhenNoKey`, `now` |

`RateLimitGuard` is a per-key **token bucket**: each key (the chat ID by default)
gets `capacity` tokens that refill at `refillPerInterval` every `intervalMs`. An
update consumes a token when one is available, and is blocked otherwise — giving a
configurable burst plus a steady sustained rate. Configure these as **instances**
(they hold the allowlist / the live buckets):

```ts
@UseTelegramGuards(
  new UserAllowlistGuard({ allow: [ADMIN_ID] }),
  new RateLimitGuard({ capacity: 5, refillPerInterval: 1, intervalMs: 1000 }),
)
@Command('admin') onAdmin(@Ctx() ctx: Context) { /* … */ }
```

### A custom guard

```ts
import { Injectable, type CanActivate, type ExecutionContext } from '@nestjs/common';
import { TelegramExecutionContext, type TelegramGuard } from 'nestjs-telegram';

@Injectable()
export class HasUsernameGuard implements TelegramGuard {
  canActivate(context: ExecutionContext): boolean {
    const ctx = TelegramExecutionContext.create(context).getContext();
    return Boolean(ctx.from?.username);
  }
}
```

## Interceptors

An interceptor is a NestJS `NestInterceptor`. `intercept(context, next)` may run
logic before and after the handler, transform/observe the result, or
**short-circuit** by not calling `next.handle()`. The handler runs when the
returned stream is subscribed, after every interceptor's pre-phase.

```ts
import { Injectable, Logger, type CallHandler, type ExecutionContext, type NestInterceptor } from '@nestjs/common';
import { tap } from 'rxjs';
import { TelegramExecutionContext } from 'nestjs-telegram';

@Injectable()
export class TimingInterceptor implements NestInterceptor {
  private readonly _log = new Logger(TimingInterceptor.name);

  intercept(context: ExecutionContext, next: CallHandler) {
    const ctx = TelegramExecutionContext.create(context).getContext();
    const startedAt = Date.now();
    return next
      .handle()
      .pipe(tap(() => this._log.debug(`update ${ctx.updateType} took ${Date.now() - startedAt}ms`)));
  }
}
```

## Exception filters

A filter is a NestJS `ExceptionFilter`: `catch(exception, host)`. Any error from a
guard, interceptor, or the handler is routed to the **first** filter whose
`@Catch(...)` types match the error (a filter with `@Catch()` or no `@Catch`
catches everything). If no filter matches, the error is logged by the registrar
and isolated — one failing handler never breaks the others.

### The default filter

`TelegramExceptionFilter` logs the error and, when configured, replies to the user:

```ts
@UseTelegramFilters(
  new TelegramExceptionFilter({
    // string or (exception, ctx) => string | undefined
    reply: (error) => (error instanceof RangeError ? 'Out of range.' : 'Something went wrong.'),
  }),
)
@Command('risky') onRisky(@Ctx() ctx: Context) { /* … */ }
```

Pass `logger: false` to silence logging, or a custom `LoggerService` to redirect it.

### A typed filter with `@Catch`

```ts
import { Catch, type ArgumentsHost, type ExceptionFilter } from '@nestjs/common';
import { TelegramExecutionContext } from 'nestjs-telegram';

@Catch(MyDomainError)
export class DomainErrorFilter implements ExceptionFilter {
  async catch(error: unknown, host: ArgumentsHost) {
    const ctx = TelegramExecutionContext.create(host).getContext();
    await ctx.reply(`Could not complete: ${(error as MyDomainError).message}`);
  }
}
```

## Execution order

- **Guards** run **class-level first, then method-level**, in order. The first
  falsy result blocks the update.
- **Interceptors** wrap with **class-level outermost**, then method-level, then the
  handler in the centre.
- **Filters** are searched **method-level first, then class-level**; the first
  whose `@Catch` types match the error handles it.

## Instances vs class refs (DI)

Each `@UseTelegram*` decorator accepts either form, mixed freely:

- **Instance** — `new RateLimitGuard({ … })`. Used as-is. Best for configured
  built-ins and for enhancers that hold state (a rate-limiter's buckets).
- **Class** — `MyGuard`. Resolved from the Nest container, so it gets normal
  constructor injection. **Register it as a provider** in a module. If it cannot
  be resolved, bootstrap fails fast with a `TelegramConfigError` telling you to
  register it or pass an instance.

```ts
@UseTelegramInterceptors(TimingInterceptor)   // class ref → DI
@UseTelegramGuards(new ChatAllowlistGuard({ allow: [id] }))  // instance
```

## The execution context

`TelegramExecutionContext` implements NestJS's `ExecutionContext` over a single
update:

- `getContext()` → the Telegraf `Context` (use this in your enhancers).
- `getType()` → `'telegram'`.
- `getHandler()` / `getClass()` → the decorated method and its provider class,
  for `Reflector`-based metadata reads.
- `getArgs()` / `getArgByIndex(0)` → the `Context` (the sole handler argument).
- `switchToHttp()` / `switchToRpc()` / `switchToWs()` → **throw**; an update is not
  an HTTP/RPC/WS message. Use `getContext()` instead.

Always recover the context with the static `TelegramExecutionContext.create(host)`
— it accepts the `ExecutionContext` (guards/interceptors) or `ArgumentsHost`
(filters) Nest hands you and returns a `TelegramExecutionContext`.

## Behaviour notes & edge cases

- **Guard denial is silent**, logged at `debug` level (not an error). There is no
  HTTP response to send; the update is simply dropped.
- **Errors are isolated.** A handler error handled by a filter is swallowed; an
  unhandled one is logged via the Nest `Logger` (same guarantee as without
  enhancers).
- **No enhancers ⇒ no overhead.** Handlers without any enhancers take the original
  fast path; the execution context and pipeline are only built when needed.
- **Stateful enhancers should be instances.** `RateLimitGuard` keeps its buckets in
  memory, so a single shared instance enforces the limit across updates. (A
  class ref resolved as a Nest singleton works too — but a different ref per
  handler means separate buckets.)
- **Singleton scope.** Enhancers are resolved once at bootstrap, like the handlers
  themselves; keep them default-scoped.

## Environment variables

This feature reads no environment variables. The surrounding module needs a bot
token (`TelegramBotModule.forRoot/forRootAsync`).

## Security notes

- **Authorize with allowlists.** `ChatAllowlistGuard` / `UserAllowlistGuard` are
  the simplest way to restrict a bot or a command to known chats/users. They deny
  by default when the chat/sender is missing (override with `allowWhenNoChat` /
  `allowWhenNoSender` only if you understand the implication).
- **Rate-limit untrusted input.** `RateLimitGuard` mitigates floods/abuse; choose a
  `capacity`/`refillPerInterval` that fits the command's cost.
- **Don't leak internals in replies.** When a filter replies on error, send a
  generic message — avoid echoing exception messages or stack traces to users.
- **Never log secrets.** Filters receive only the update context and the error;
  avoid logging full update payloads (they can contain personal data).

## How to extend

- **A new built-in guard:** implement `CanActivate` (`implements TelegramGuard`),
  read the update via `TelegramExecutionContext.create(context).getContext()`,
  return a verdict. Drop it under `src/lib/bot/updates/guards/` with a co-located
  spec and export it from that barrel.
- **A new built-in filter:** implement `ExceptionFilter`, optionally annotate with
  `@Catch(SomeError)` to scope it, and place it under
  `src/lib/bot/updates/filters/`.
- **Per-handler metadata:** combine a `SetMetadata`-style decorator with a
  `Reflector` read inside your guard/interceptor against
  `context.getHandler()` / `context.getClass()` — the standard NestJS pattern.
