# Runtime-Reconfigurable Bot

Most bots get their token from the environment once, at startup. Some can't: the
token is **application state** — stored in a database, set/rotated/removed through
an admin UI, and changed without restarting the process. `TelegramBotModule.forRootRuntime()`
plus the injectable **`TelegramBotRuntime`** manager model exactly that: a bot
registered with **no token at boot** that you `configure({ token })` (and rotate,
stop, or clear) at runtime. It is **boot-safe** (a missing/invalid token never
crashes bootstrap), **single-poller aware** (a Telegram `409` conflict surfaces as
a status, not a crash), and re-binds every decorator handler/guard/filter/scene
onto each freshly built instance.

This is **additive**: the static `forRoot` / `forRootAsync` path is unchanged.

---

## Table of contents

1. [When to use it](#1-when-to-use-it)
2. [Architecture overview](#2-architecture-overview)
3. [File structure](#3-file-structure)
4. [Environment variables](#4-environment-variables)
5. [Quick start](#5-quick-start)
6. [Lifecycle & status flow](#6-lifecycle--status-flow)
7. [API reference](#7-api-reference)
8. [Named runtime bots](#8-named-runtime-bots)
9. [Testing (no network)](#9-testing-no-network)
10. [Security notes](#10-security-notes)
11. [How to extend](#11-how-to-extend)

---

## 1. When to use it

Use `forRootRuntime` when **any** of these is true:

- The token lives in a database / secret manager and is set or rotated by an
  operator at runtime (e.g. AES-256-GCM-encrypted in Postgres, edited via a
  settings page) — **no app restart** on change.
- The bot must be **enable/disable**-able at runtime.
- Bootstrap must **never crash** when the token is missing, revoked, or its
  encryption key is unavailable — the app stays up and reports a status instead.

If your token is a fixed env var, prefer the simpler static
[`forRoot` / `forRootAsync`](./BOT-API.md#2-registering-the-module). The two can
coexist (see [§8](#8-named-runtime-bots)).

---

## 2. Architecture overview

`forRootRuntime` registers **no `Telegraf` instance, facade, or registrar** at
boot — only the `TelegramBotRuntime` manager, its baseline options, a metrics
sink, a tracer, and the enhancer resolver. Nothing connects to Telegram until the
first `configure()`.

On each `configure({ token })`, the manager:

1. **Stops** any currently running instance (clean stop → no leaked poller).
2. **Builds** a fresh `Telegraf` via the same pure factory the static path uses
   (`createTelegrafInstance`, or a test seam — see [§9](#9-testing-no-network)).
3. **Re-binds** every discovered `@TelegramUpdate` handler, guard, interceptor,
   filter, and `@Scene` onto that instance, by constructing the library's existing
   `TelegramBotUpdatesRegistrar` + `TelegramBotScenesRegistrar` against it — the
   exact same binding the static bootstrap performs, scoped to this bot's `name`.
4. **Validates** the token via `getMe` (capturing `botUsername`).
5. **Launches** long-polling (or webhook), unless `launch: false`.
6. **Syncs** the `@Command` menu (when `commands.autoRegister` is on).

```text
              forRootRuntime()                         configure({ token })
  ┌─────────────────────────────────┐      ┌────────────────────────────────────┐
  │ TelegramBotRuntime (manager)    │      │ stop old → createTelegrafInstance → │
  │ baseline options, metrics,      │ ───▶ │ bind handlers/guards/scenes (by     │
  │ tracer, enhancer resolver       │      │ name) → getMe → launch → setCommands│
  │ NO Telegraf instance yet        │      │ → status: online | error            │
  └─────────────────────────────────┘      └────────────────────────────────────┘
```

Because the manager **reuses** the static registrars rather than re-implementing
the binding, the decorator system (`@Command`, `@Action`, `@On`, `@Use`,
`@Scene`, `@UseTelegramGuards`, …) behaves identically on a runtime bot.

All mutating calls (`configure` / `setToken` / `stop` / `clear`) are **serialized**
through an internal queue, so a stop can never interleave with a concurrent
rebuild — each (re)configuration is atomic.

---

## 3. File structure

```text
src/lib/bot/runtime/
├── telegram-bot-runtime.service.ts     # TelegramBotRuntime — the lifecycle manager
├── telegram-bot-runtime.types.ts       # status union + snapshot + options types
├── telegram-bot-runtime.constants.ts   # getBotRuntimeToken / InjectBotRuntime
└── index.ts                            # barrel (re-exported from telenest/bot)

src/lib/testing/
└── mock-telegraf.ts                    # createMockTelegraf — network-free botFactory
```

The manager is wired by `TelegramBotModule.forRootRuntime` in
`src/lib/bot/telegram-bot.module.ts`.

---

## 4. Environment variables

This feature reads **no environment variables** itself — the whole point is that
the token arrives at runtime from wherever your app stores it (a DB row, a secret
manager, an admin form). Your application decides the source and calls
`configure({ token })`.

---

## 5. Quick start

Register a runtime bot (here globally, with no token):

```ts
import { Module } from '@nestjs/common';
import { TelegramBotModule } from 'telenest';

@Module({
  imports: [TelegramBotModule.forRootRuntime({ isGlobal: true })],
})
export class AppModule {}
```

Declare handlers exactly as for a static bot — they bind on every (re)build:

```ts
import { Injectable } from '@nestjs/common';
import { Command, Ctx, TelegramUpdate } from 'telenest';
import type { Context } from 'telegraf';

@TelegramUpdate()
@Injectable()
export class GreetingUpdate {
  @Command('start')
  onStart(@Ctx() ctx: Context) {
    return ctx.reply('Hello from a runtime-configured bot!');
  }
}
```

Drive the lifecycle from your token-management code:

```ts
import { Injectable } from '@nestjs/common';
import { InjectBotRuntime, TelegramBotRuntime } from 'telenest';

@Injectable()
export class BotSettingsService {
  constructor(
    @InjectBotRuntime() private readonly bot: TelegramBotRuntime,
  ) {}

  /** Operator saved or rotated the token in the admin UI. */
  async onTokenSaved(token: string): Promise<void> {
    const { status, botUsername, lastError } = await this.bot.configure({ token });
    if (status === 'error') {
      // App keeps running — surface lastError in your status UI.
      this.logger.warn(`Bot not online: ${lastError}`);
    } else {
      this.logger.log(`Bot online as @${botUsername}`);
    }
  }

  /** Operator removed the token / disabled the bot. */
  async onTokenRemoved(): Promise<void> {
    await this.bot.clear(); // stop polling + drop the instance → offline
  }

  /** Show the bot's state on a status page. */
  status() {
    return this.bot.getStatus(); // { status, botUsername?, lastError? }
  }
}
```

If you store the token in a DB, load it on startup and call `configure` from your
own bootstrap hook — the manager itself never reads storage.

---

## 6. Lifecycle & status flow

`getStatus()` returns one of three states (modeled as an `as const` union,
`BOT_RUNTIME_STATUSES`):

| Status    | Meaning                                                                  |
| --------- | ------------------------------------------------------------------------ |
| `offline` | No token configured, or the bot was `stop()`ped / `clear()`ed.           |
| `online`  | A token is configured and validated; polling (or webhook) is active.     |
| `error`   | The last configure/launch failed — see `lastError`. **The app stays up.** |

```text
              configure({ token })            configure({ newToken })
   offline ─────────────────────────▶ online ───────────────────────▶ online
      ▲                                  │  ▲                              │
      │ clear()                  stop()  │  │ configure() (recover)        │
      │                                  ▼  │                              │
      └────────────── offline ◀──────────┘  └──────── error ◀──────────────┘
                                              (bad/revoked token, 409 conflict,
                                               or launch failure — never thrown)
```

Key guarantees:

- **Never throws on a bad token.** A blank/missing/revoked token, a `getMe`
  rejection, or a launch failure becomes `error` status with a readable
  `lastError`; the call resolves normally.
- **`409` single-poller conflicts** ("terminated by other getUpdates request")
  map to `error` with an actionable message — useful when two instances briefly
  share a token during a deploy.
- **`stop()` keeps the instance** (so `instance` / `telegram` / `service` still
  work for one-off API calls); **`clear()` drops it** (those accessors then throw
  a clear "not configured" `TelegramConfigError`).

---

## 7. API reference

### `TelegramBotModule.forRootRuntime(options?)`

Registers a runtime bot. `options` is the same surface as
[`TelegramBotModuleOptions`](./BOT-API.md#3-module-options-reference) **minus
`token`**, plus the `isGlobal` / `name` extras and a `botFactory` test seam:

| Option          | Type                              | Default | Notes                                                                 |
| --------------- | --------------------------------- | ------- | --------------------------------------------------------------------- |
| `isGlobal`      | `boolean`                         | `false` | Register the manager globally.                                        |
| `name`          | `string`                          | default | Register one of several runtime bots (see [§8](#8-named-runtime-bots)). |
| `telegraf`      | `Partial<Telegraf.Options>`       | —       | Forwarded to the `Telegraf` constructor on each build.                |
| `launchOptions` | `Telegraf.LaunchOptions`          | —       | Polling/webhook options for `launch()`.                               |
| `launch`        | `boolean`                         | `true`  | Set `false` to bind without polling (manual/webhook control).         |
| `commands`      | `{ autoRegister?: boolean }`      | —       | Sync the `@Command` menu after each launch.                           |
| `scenes`        | `{ session?: boolean }`           | —       | Scene session-middleware control.                                     |
| `metrics`       | `TelegramMetricsRecorder`         | in-mem  | Per-bot counters.                                                     |
| `botFactory`    | `(opts) => Telegraf`              | real    | Build the instance yourself — used by tests to avoid the network.     |

### `TelegramBotRuntime`

Inject with `@InjectBotRuntime(name?)` (or via `getBotRuntimeToken(name)`).

| Member                         | Returns                       | Description                                                                                   |
| ------------------------------ | ----------------------------- | --------------------------------------------------------------------------------------------- |
| `configure(options)`           | `Promise<…Status>`            | Stop → build → re-bind → validate → launch. Atomic; never throws.                             |
| `setToken(token)`              | `Promise<…Status>`            | Shorthand for `configure({ token })`.                                                          |
| `stop(reason?)`                | `Promise<…Status>`            | Stop polling, **keep** the instance. → `offline`.                                             |
| `clear()`                      | `Promise<…Status>`            | Stop polling and **drop** the instance. → `offline`.                                          |
| `getStatus()`                  | `TelegramBotRuntimeStatus`    | `{ status, botUsername?, lastError? }` — token-free, safe to expose.                          |
| `isConfigured`                 | `boolean`                     | Whether an instance is currently built.                                                        |
| `instance`                     | `Telegraf`                    | Raw instance; **throws** `TelegramConfigError` when not configured.                            |
| `telegram`                     | `Telegram`                    | Raw Bot API client; **throws** when not configured.                                            |
| `service`                      | `TelegramBotService`          | Typed facade (`sendMessage`, retries, codecs…) over the current instance; **throws** when not. |

`configure` resolves to the resulting `TelegramBotRuntimeStatus`; inspect
`status` / `lastError` rather than wrapping it in `try/catch`.

---

## 8. Named runtime bots

Pass `name` to run several runtime bots — or to mix runtime and static bots —
in one app. Handlers are scoped with `@TelegramUpdate({ bot: name })` exactly as
for [multiple static bots](./MULTIPLE-BOTS.md):

```ts
@Module({
  imports: [
    // A static, env-token bot…
    TelegramBotModule.forRoot({ token: process.env.PUBLIC_BOT_TOKEN! }),
    // …alongside a runtime, DB-token bot.
    TelegramBotModule.forRootRuntime({ name: 'tenant' }),
  ],
})
export class AppModule {}

@TelegramUpdate({ bot: 'tenant' }) // binds only onto the 'tenant' runtime bot
@Injectable()
class TenantUpdate {
  @Command('whoami') whoami(@Ctx() ctx: Context) { /* … */ }
}

@Injectable()
class Wiring {
  constructor(@InjectBotRuntime('tenant') private readonly tenant: TelegramBotRuntime) {}
}
```

Each runtime bot only binds the handlers whose target bot matches its `name`, and
owns its own metrics/tracer — no collisions.

---

## 9. Testing (no network)

Supply a `botFactory` that returns the bundled fake `Telegraf`
(`createMockTelegraf` from `telenest/testing`) so unit tests configure and launch
the bot without ever opening a connection:

```ts
import { Test } from '@nestjs/testing';
import {
  TelegramBotModule,
  TelegramBotRuntime,
  getBotRuntimeToken,
} from 'telenest';
import { asTelegraf, createMockTelegraf } from 'telenest/testing';

const moduleRef = await Test.createTestingModule({
  imports: [
    TelegramBotModule.forRootRuntime({
      botFactory: () => asTelegraf(createMockTelegraf()),
    }),
  ],
  providers: [GreetingUpdate],
}).compile();

const runtime = moduleRef.get<TelegramBotRuntime>(getBotRuntimeToken(), {
  strict: false,
});

const { status } = await runtime.configure({ token: '123:abc' });
expect(status).toBe('online');
```

`createMockTelegraf()` exposes `jest.fn()` spies for every registration method,
`launch`/`stop`, and `telegram.getMe` / `telegram.setMyCommands`. By default
`launch()` stays pending (like real long-polling) and `getMe()` resolves a mock
bot. Override any spy to exercise the error paths — e.g. a rejecting `getMe`
(revoked token) or a rejecting `launch` (a `409` conflict). See
[TESTING.md](./TESTING.md).

---

## 10. Security notes

- **The token is never logged and never appears in `getStatus()`.** The status
  snapshot carries only `status`, `botUsername`, and a `lastError` message —
  safe to render on an admin/status page.
- **Store the token encrypted at rest** (e.g. AES-256-GCM). The manager treats the
  token as opaque; encryption/decryption is your application's responsibility.
  Pair it with the [`EncryptedSessionStore`](./SESSION-STORES.md) approach if you
  also persist MTProto sessions.
- **Boot-safe by design.** A missing decryption key or revoked token yields
  `error` status — surface it, but never let it crash bootstrap.
- **Single-poller hygiene.** Run exactly one poller per token. During deploys,
  expect a transient `409`; the manager reports it as `error` so you can react
  (e.g. retry once the old instance has drained).

---

## 11. How to extend

- **Persisting the token:** load it from your store on startup and call
  `configure({ token })` from an `OnApplicationBootstrap` hook in your own
  service; persist new tokens before calling `configure` so a restart re-applies
  the latest.
- **Webhook mode:** pass `launch: false` (the handlers still bind and the token is
  validated), then mount `runtime.instance.webhookCallback(path)` on your HTTP
  server, or use the built-in [webhook controller](./WEBHOOK-CONTROLLER.md).
- **Reacting to status:** poll `getStatus()` from a health endpoint, or wrap
  `configure` in your own service that emits events on `online` / `error`
  transitions.
- **Custom build:** supply `botFactory` to inject a pre-configured `Telegraf`
  (custom agent, test environment) instead of the default `createTelegrafInstance`.

See also: [BOT-API.md](./BOT-API.md) · [MULTIPLE-BOTS.md](./MULTIPLE-BOTS.md) ·
[BOT-UPDATE-DECORATORS.md](./BOT-UPDATE-DECORATORS.md) ·
[WEBHOOK-CONTROLLER.md](./WEBHOOK-CONTROLLER.md) · [TESTING.md](./TESTING.md)
