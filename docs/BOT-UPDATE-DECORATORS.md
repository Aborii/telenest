# Bot API Update Decorators

A first-class, decorator-based way to handle Bot API updates with
`nestjs-telegram` — **without** `nestjs-telegraf` and without reaching for the raw
`Telegraf` instance. You declare handlers as ordinary NestJS providers; a
`DiscoveryService`-driven registrar finds every `@TelegramUpdate` class at
bootstrap and binds its methods onto the bot **before launch**, resolving each
method's arguments from the update context.

> **Bot API only.** These decorators drive the Bot API side
> (`TelegramBotModule`, a BotFather token). They are unrelated to the MTProto
> user-account `@OnUserMessage` system documented in
> [USER-CLIENT-MTPROTO.md](./USER-CLIENT-MTPROTO.md).

---

## Table of contents

- [Architecture overview](#architecture-overview)
- [File structure](#file-structure)
- [Quick start](#quick-start)
- [Method decorators](#method-decorators)
- [Parameter decorators](#parameter-decorators)
- [Dispatch flow](#dispatch-flow)
- [Behaviour notes & edge cases](#behaviour-notes--edge-cases)
- [Environment variables](#environment-variables)
- [Security notes](#security-notes)
- [How to extend](#how-to-extend)

---

## Architecture overview

The system has four cooperating pieces, all under `src/lib/bot/updates`:

1. **Decorators** record intent as reflect-metadata.
   - `@TelegramUpdate()` marks a class as a handler provider to scan.
   - Method decorators (`@Start`, `@Help`, `@Command`, `@Hears`, `@Action`,
     `@On`, `@Use`) append an `UpdateBinding` describing which `Telegraf` method
     the handler binds to and with what trigger.
   - Parameter decorators (`@Ctx`, `@MessageText`, `@Sender`, `@CallbackData`)
     append a `ParamMetadata` describing what to inject at each argument slot.
2. **The argument resolver** (`resolveHandlerArguments`) is a pure function that
   turns a Telegraf `Context` + the method's `ParamMetadata[]` into the positional
   argument array passed to the handler.
3. **The registrar** (`TelegramBotUpdatesRegistrar`) runs in `onModuleInit`,
   enumerates `@TelegramUpdate` providers via `DiscoveryService`, and binds every
   decorated method onto the shared `Telegraf` instance.
4. **`TelegramBotModule`** wires `DiscoveryModule` + the registrar so all of the
   above happens automatically.

Because Nest runs **all** `onModuleInit` hooks before **any**
`onApplicationBootstrap`, the registrar always binds handlers before
`TelegramBotService` launches the bot — so no update is ever missed.

```text
@TelegramUpdate class ──(decorators write metadata)──► reflect-metadata
                                                            │
TelegramBotModule (onModuleInit)                            │
   └─ TelegramBotUpdatesRegistrar                           │
        ├─ DiscoveryService.getProviders() ────────────────┘
        ├─ for each @TelegramUpdate method: read bindings + params
        └─ bot.<start|command|hears|action|on|use>(trigger?, middleware)
                                                  │
update arrives ──► Telegraf middleware ──► resolveHandlerArguments(ctx, params)
                                       └──► handler.apply(instance, args)
```

## File structure

```text
src/lib/bot/updates/
  telegram-update.types.ts          # BOT_UPDATE_KINDS / PARAM_KINDS (as-const, no enum),
                                     #   UpdateBinding union, ParamMetadata, metadata keys
  telegram-update.decorator.ts      # @TelegramUpdate + @Start/@Help/@Command/@Hears/@Action/@On/@Use
  param.decorators.ts               # @Ctx / @MessageText / @Sender / @CallbackData
  argument-resolver.ts              # resolveHandlerArguments(ctx, params) — pure
  telegram-bot-updates.registrar.ts # DiscoveryService scanner; binds to Telegraf before launch
  index.ts                          # barrel
```

The registrar is added to `TelegramBotModule` alongside `DiscoveryModule`; the
decorators are re-exported from the package root (`nestjs-telegram`) and from the
`nestjs-telegram/bot` subpath.

## Quick start

```ts
import { Injectable, Module } from '@nestjs/common';
import type { Context } from 'telegraf';
import {
  TelegramBotModule,
  TelegramUpdate,
  Start,
  Command,
  Ctx,
  Sender,
} from 'nestjs-telegram';

@TelegramUpdate()
@Injectable()
export class GreeterUpdate {
  @Start()
  async onStart(@Ctx() ctx: Context, @Sender() from: Context['from']) {
    await ctx.reply(`Hello ${from?.first_name ?? 'friend'}!`);
  }

  @Command('ping')
  async onPing(@Ctx() ctx: Context) {
    await ctx.reply('pong');
  }
}

@Module({
  imports: [TelegramBotModule.forRoot({ token: process.env.BOT_TOKEN! })],
  providers: [GreeterUpdate], // just a provider
})
export class AppModule {}
```

A complete, runnable reference (every decorator, DI, inline-keyboard callbacks)
lives at [`examples/decorator-bot.example.ts`](../examples/decorator-bot.example.ts).

## Method decorators

Each binds the method onto the matching `Telegraf` method. Triggers are typed
straight from Telegraf (`Parameters<Telegraf['command']>[0]`, etc.), so they stay
in lock-step with the installed Telegraf version. Decorators may be **stacked**
on one method (e.g. `@Command('a') @Command('b')`).

| Decorator | Binds to | Trigger argument |
| --- | --- | --- |
| `@Start()` | `bot.start` | — |
| `@Help()` | `bot.help` | — |
| `@Command(name)` | `bot.command` | command name(s) |
| `@Hears(trigger)` | `bot.hears` | string / RegExp / predicate / array |
| `@Action(trigger)` | `bot.action` | callback-data string / RegExp / array |
| `@On(updateType)` | `bot.on` | update-type filter(s), e.g. `'text'` |
| `@Use()` | `bot.use` | — (global middleware) |

Matched handlers (`start`, `help`, `command`, `hears`, `action`, `on`) are
**terminal** — they do not call `next`. `@Use()` middleware is **not** terminal:
the registrar calls `next()` after it so the chain continues.

## Parameter decorators

| Decorator | Injects | Type | Absent → |
| --- | --- | --- | --- |
| `@Ctx()` | the raw Telegraf `Context` | `Context` | always present |
| `@MessageText()` | `ctx.text` | `string \| undefined` | `undefined` |
| `@Sender()` | `ctx.from` | `User \| undefined` | `undefined` |
| `@CallbackData()` | callback query `data` | `string \| undefined` | `undefined` |

If a method has **no** parameter decorators, the raw `Context` is passed as the
single argument (the common `(ctx) => …` ergonomic). Otherwise the resolver builds
an array sized to the highest decorated index; undecorated slots stay `undefined`.

## Dispatch flow

1. An update arrives; Telegraf runs the middleware the registrar bound.
2. The middleware calls `resolveHandlerArguments(ctx, params)` to build the args.
3. `handler.apply(instance, args)` runs the method with the provider as `this`.
4. Any thrown error is caught and logged — one failing handler never breaks the
   pipeline for the others.

## Behaviour notes & edge cases

- **Only marked classes are scanned.** A method decorator on a class without
  `@TelegramUpdate()` is ignored (no binding).
- **Singleton scope.** Discovery binds the singleton instance. Request-scoped
  providers have no resolvable instance at bootstrap and are skipped — keep
  handler classes default-scoped.
- **Handlers are global.** A `@TelegramUpdate` provider anywhere in the app binds
  to the one bot, exactly like the raw `bot.command(...)` it replaces.
- **Errors are isolated, not swallowed silently** — they are logged via the Nest
  `Logger` with the handler's `Class.method` label.
- **`@Use()` ordering** follows discovery order, since Telegraf runs middleware in
  registration order.

## Environment variables

This feature reads no environment variables itself. The surrounding module needs
a bot token, conventionally `BOT_TOKEN`, supplied to `TelegramBotModule.forRoot`
/ `forRootAsync` (see the example).

## Security notes

- **Never log secrets.** The bot token is held by `TelegramBotModule`; handlers
  receive only the update `Context`. Avoid logging full update payloads in
  production — they can contain personal data.
- **Validate untrusted input.** `@MessageText()` / `@CallbackData()` are
  user-controlled strings; treat them as untrusted (`unknown`-grade) input and
  validate before acting on them.

## How to extend

- **A new update kind:** add a value to `BOT_UPDATE_KINDS`, a variant to the
  `UpdateBinding` union (with its trigger typed from Telegraf), a method decorator
  that appends it, and a `case` in the registrar's `bind` switch — the
  exhaustiveness guard (`const exhaustive: never = binding`) forces you to handle
  it or the build fails.
- **A new injectable parameter:** add a value to `PARAM_KINDS`, a parameter
  decorator that appends it, and a `case` in the resolver's `resolveParam` switch
  (again guarded by an exhaustiveness check).
- **Guards / pipes:** the registrar is the single binding point — a future guards
  feature would wrap the middleware here, keeping handlers unchanged.
```
