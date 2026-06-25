# Observability — Health, Metrics & Tracing

`nestjs-telegram` ships an opt-in, dependency-light observability layer so you can
answer three operational questions about each side of the library: **is it up?**
(health indicators), **how much traffic / how many errors?** (metrics counters),
and **where is the latency?** (tracing spans). Everything is wired with zero hard
dependencies — `@nestjs/terminus` and `@opentelemetry/api` are **never imported**
by the library; you bridge your own when you want them, and the lib still loads
without either installed.

> **Decoupling note.** The Bot API and MTProto sides stay independent (they share
> code only through `common`), so observability is **per-side**: there is a
> `TelegramBotHealthIndicator` and a `TelegramClientHealthIndicator`, a per-bot
> metrics sink and a per-account metrics sink, etc. There is intentionally **no**
> single indicator that probes both — composing them is the consumer's job (one
> `health.check([...])` call lists both). This diverges from the original issue's
> single-`TelegramHealthIndicator` sketch, which would have violated the hard
> Bot ⟷ MTProto boundary.

## Table of Contents

- [Architecture Overview](#architecture-overview)
- [File Structure](#file-structure)
- [Environment Variables](#environment-variables)
- [Health Checks (`@nestjs/terminus`)](#health-checks-nestjsterminus)
- [Metrics](#metrics)
  - [What is counted, and where](#what-is-counted-and-where)
  - [Reading counters](#reading-counters)
  - [Swapping the recorder](#swapping-the-recorder)
  - [Bridging to Prometheus](#bridging-to-prometheus)
  - [Bridging to OpenTelemetry metrics](#bridging-to-opentelemetry-metrics)
- [Tracing (OpenTelemetry)](#tracing-opentelemetry)
- [DI Tokens (default & named)](#di-tokens-default--named)
- [Security Notes](#security-notes)
- [How To Extend](#how-to-extend)

## Architecture Overview

Three small primitives live in `common` (dependency-free, importable by both
sides), and each feature module wires them at its natural chokepoints:

| Concern     | Shared primitive (`common`)                                  | Bot wiring                                              | Client wiring                                             |
| ----------- | ------------------------------------------------------------ | ------------------------------------------------------ | -------------------------------------------------------- |
| **Health**  | `runHealthCheck`, `HealthStatus`, `TelegramHealthIndicatorResult` | `TelegramBotHealthIndicator` (`getMe`)                 | `TelegramClientHealthIndicator` (`isConnected`/`isAuthorized`) |
| **Metrics** | `TelegramMetrics` / `InMemoryTelegramMetrics`, `TELEGRAM_COUNTERS` | `TelegramBotService.exec` chokepoint + opt-in middleware | `TelegramUserService` (`sendMessage`/`sendFile`/inbound) |
| **Tracing** | `TelegramTracer`, `createOpenTelemetryTracer`                | span around every `TelegramBotService.exec` call       | opt-in via the same primitive                            |

The two integrations stay optional by **structural typing**: the terminus result
shape and the OTel tracer/span shapes are described by the library's own
interfaces, so neither package is ever `import`ed. Install them only if you use
them.

## File Structure

```text
src/lib/
├── common/observability/
│   ├── telegram-metrics.ts     # counters, recorder/readable interfaces, InMemory + Noop
│   ├── telegram-metrics-exporter.ts # createOpenTelemetryMetrics + toPrometheusMetrics
│   ├── telegram-tracer.ts      # TelegramTracer, Noop, createOpenTelemetryTracer (OTel bridge)
│   ├── telegram-health.ts      # HealthStatus, result shape, runHealthCheck helper
│   └── index.ts
├── bot/
│   ├── telegram-bot.health.ts            # TelegramBotHealthIndicator
│   ├── telegram-bot.metrics-middleware.ts# telegramBotMetricsMiddleware (opt-in inbound counter)
│   ├── telegram-bot.constants.ts         # + TELEGRAM_BOT_METRICS / TELEGRAM_BOT_TRACER tokens
│   ├── telegram-bot.tokens.ts            # + getBotMetricsToken/getBotTracerToken/getBotHealthToken
│   └── telegram-bot.service.ts           # exec() records sent/errors/floods + traces
└── client/
    ├── telegram-client.health.ts         # TelegramClientHealthIndicator
    ├── telegram-client.constants.ts      # + TELEGRAM_CLIENT_METRICS token
    ├── telegram-client.tokens.ts         # + getClientMetricsToken/getClientHealthToken
    └── telegram-user.service.ts          # records sent + inbound received
```

## Environment Variables

None. Observability is configured entirely through DI (provider overrides), not
environment variables.

## Health Checks (`@nestjs/terminus`)

Each side exposes an injectable indicator whose `isHealthy(key?)` returns a
terminus-compatible `HealthIndicatorResult` and **never throws** (a failure is
reported as `down`, so the health endpoint stays up). Install terminus in your
app (`npm i @nestjs/terminus`) and wire both indicators:

```ts
import { Controller, Get } from '@nestjs/common';
import { HealthCheck, HealthCheckService } from '@nestjs/terminus';
import {
  TelegramBotHealthIndicator,
  TelegramClientHealthIndicator,
} from 'nestjs-telegram';

@Controller('health')
export class HealthController {
  constructor(
    private readonly health: HealthCheckService,
    private readonly botHealth: TelegramBotHealthIndicator,
    private readonly clientHealth: TelegramClientHealthIndicator,
  ) {}

  @Get()
  @HealthCheck()
  check() {
    return this.health.check([
      () => this.botHealth.isHealthy('telegram-bot'),
      () => this.clientHealth.isHealthy('telegram-client'),
    ]);
  }
}
```

Result shapes:

- **Bot** — `up`: `{ 'telegram-bot': { status: 'up', id, username } }`; `down`:
  `{ 'telegram-bot': { status: 'down', error } }`.
- **Client** — `up` requires connected **and** authorized:
  `{ 'telegram-client': { status: 'up', connected: true, authorized: true } }`;
  otherwise `down` with the same booleans plus an `error` reason.

> The bot indicator calls `getMe()` on each probe, which is a real Bot API
> request — point your liveness/readiness probe interval accordingly.

## Metrics

The library tracks four monotonic counters, named by the `TELEGRAM_COUNTERS`
record:

| Counter            | Meaning                                                        |
| ------------------ | ------------------------------------------------------------- |
| `messagesSent`     | Outbound sends that succeeded.                                |
| `messagesReceived` | Inbound messages observed.                                    |
| `apiErrors`        | API calls that failed (after error normalization).            |
| `floodWaits`       | Failures carrying a Telegram `retry_after` / flood-wait.      |

### What is counted, and where

Wiring is **minimal-touch** — recorded at the safe chokepoints, not threaded
through every call site:

| Counter            | Bot side                                                                 | Client side                                  |
| ------------------ | ------------------------------------------------------------------------ | -------------------------------------------- |
| `messagesSent`     | ✅ auto — `TelegramBotService.exec` on any successful `send*` (except `sendChatAction`) | ✅ auto — `TelegramUserService.sendMessage` / `sendFile` |
| `apiErrors`        | ✅ auto — `exec` on any failed Bot API call                              | consumer-recorded (see [How To Extend](#how-to-extend)) |
| `floodWaits`       | ✅ auto — `exec` when the error carries `retry_after`                    | consumer-recorded                            |
| `messagesReceived` | opt-in — register `telegramBotMetricsMiddleware` (below)                  | ✅ auto — inbound `onNewMessage` events       |

Bot inbound counting is opt-in rather than auto-installed so the library never
silently mutates your Telegraf middleware pipeline. Register it **first** so it
sees every update:

```ts
import { Inject } from '@nestjs/common';
import {
  TELEGRAM_BOT_METRICS,
  TelegramBotService,
  telegramBotMetricsMiddleware,
  type TelegramMetricsRecorder,
} from 'nestjs-telegram';

constructor(
  private readonly bot: TelegramBotService,
  @Inject(TELEGRAM_BOT_METRICS) metrics: TelegramMetricsRecorder,
) {
  this.bot.use(telegramBotMetricsMiddleware(metrics));
}
```

### Reading counters

Each bot/account gets its own `InMemoryTelegramMetrics`. Inject it via the metrics
token and call `snapshot()`:

```ts
import { Inject } from '@nestjs/common';
import { TELEGRAM_BOT_METRICS, type TelegramMetrics } from 'nestjs-telegram';

constructor(@Inject(TELEGRAM_BOT_METRICS) private readonly metrics: TelegramMetrics) {}

stats() {
  const { messagesSent, apiErrors, floodWaits } = this.metrics.snapshot();
  return { messagesSent, apiErrors, floodWaits };
}
```

`snapshot()` returns a defensive copy; `reset()` zeroes every counter. Counters
are **totals**, not rates — sample `snapshot()` over time to derive rates.

### Swapping the recorder

Both modules accept a `metrics` option to replace the default
`InMemoryTelegramMetrics` for that bot/account — supply any
`TelegramMetricsRecorder` (e.g. an OpenTelemetry bridge, below). It defaults to a
fresh in-memory sink, so there is **zero cost** when you leave it unset.

```ts
TelegramBotModule.forRoot({ token, metrics: myRecorder });
TelegramClientModule.forRoot({ apiId, apiHash, metrics: myRecorder });
```

> A swapped-in write-only recorder (like the OTel bridge) has no `.snapshot()`.
> Keep the default in-memory sink if you also want to read counters / serve the
> Prometheus snapshot below.

### Bridging to Prometheus

Render the in-memory snapshot as Prometheus text-exposition format with the
built-in `toPrometheusMetrics` helper, and serve it from a `/metrics` route:

```ts
import { Controller, Get, Header, Inject } from '@nestjs/common';
import {
  TELEGRAM_BOT_METRICS,
  toPrometheusMetrics,
  type TelegramMetrics,
} from 'nestjs-telegram';

@Controller()
export class MetricsController {
  constructor(
    @Inject(TELEGRAM_BOT_METRICS) private readonly metrics: TelegramMetrics,
  ) {}

  @Get('metrics')
  @Header('Content-Type', 'text/plain; version=0.0.4')
  metrics(): string {
    // telegram_messages_sent 12
    return toPrometheusMetrics(this.metrics.snapshot(), {
      labels: { bot: 'main' },
    });
  }
}
```

Every counter is emitted (zeros included) with `# HELP`/`# TYPE` lines; pass
`prefix` to change the `telegram_` namespace and `labels` to tag the series.

### Bridging to OpenTelemetry metrics

To push counters into an existing OpenTelemetry pipeline instead, wrap an OTel
`Meter` with `createOpenTelemetryMetrics` and pass it as the module's `metrics`
recorder. Like the tracer bridge, the library never imports `@opentelemetry/api`
— it accepts the meter structurally, so OTel stays an optional peer.

```ts
import { metrics } from '@opentelemetry/api';
import { createOpenTelemetryMetrics, TelegramBotModule } from 'nestjs-telegram';

TelegramBotModule.forRoot({
  token: process.env.BOT_TOKEN!,
  // Each increment becomes an OTel counter `add` (telegram.messagesSent, …).
  metrics: createOpenTelemetryMetrics(metrics.getMeter('telegram'), {
    attributes: { bot: 'main' }, // tag measurements (e.g. per bot/account)
  }),
});
```

`prefix` (default `telegram.`) controls the instrument names. Use `attributes`
to distinguish multiple bots/accounts forwarding to the same meter.

## Tracing (OpenTelemetry)

Every Bot API call made through `TelegramBotService` is wrapped in a span named
`telegram.bot.<method>` with a `telegram.bot.method` attribute. By default the
tracer is a **no-op** (zero overhead). To emit real spans, install
`@opentelemetry/api`, bridge your tracer, and override the bot's tracer token:

```ts
import { trace } from '@opentelemetry/api';
import {
  TelegramBotModule,
  TELEGRAM_BOT_TRACER,
  createOpenTelemetryTracer,
} from 'nestjs-telegram';

@Module({
  imports: [TelegramBotModule.forRoot({ token: process.env.BOT_TOKEN! })],
  providers: [
    {
      provide: TELEGRAM_BOT_TRACER,
      useValue: createOpenTelemetryTracer(trace.getTracer('telegram')),
    },
  ],
})
export class AppModule {}
```

The bridge records attributes, marks the span errored (and records the exception)
when the call rejects, and always ends the span. Client-side spans are **opt-in**:
build a `createOpenTelemetryTracer(...)` and wrap your own MTProto calls with
`tracer.startActiveSpan('telegram.client.<op>', () => user.someCall())`.

## DI Tokens (default & named)

Following the multi-bot / multi-account convention, the **default** bot/account
uses stable tokens, and named ones get derived tokens via helpers:

| Provider              | Default token              | Named-token helper        |
| --------------------- | -------------------------- | ------------------------- |
| Bot metrics           | `TELEGRAM_BOT_METRICS`     | `getBotMetricsToken(name)`|
| Bot tracer            | `TELEGRAM_BOT_TRACER`      | `getBotTracerToken(name)` |
| Bot health indicator  | `TelegramBotHealthIndicator` (class) | `getBotHealthToken(name)` |
| Client metrics        | `TELEGRAM_CLIENT_METRICS`  | `getClientMetricsToken(name)` |
| Client health indicator | `TelegramClientHealthIndicator` (class) | `getClientHealthToken(name)` |

```ts
// Inject a named bot's metrics:
constructor(@Inject(getBotMetricsToken('notify')) private readonly m: TelegramMetrics) {}
```

## Security Notes

- Counters hold **only aggregate numbers** — never message contents, tokens, or
  session strings. Snapshots are safe to expose on an internal metrics endpoint.
- The bot health probe surfaces the bot's `id` / `username` (public info). The
  client probe surfaces only `connected` / `authorized` booleans — no phone
  number, session, or account identity.
- Span names/attributes contain the API method name only, not payloads. If you
  add custom attributes via your own tracer, avoid putting sensitive content in
  them.

## How To Extend

- **Custom metrics backend.** Implement `TelegramMetricsRecorder` (a single
  `increment(counter, by?)` method) and override the metrics token with it, e.g.
  `{ provide: TELEGRAM_BOT_METRICS, useValue: myRecorder }`. The bot facade and
  user service will record into it directly.
- **Record client `apiErrors` / `floodWaits`.** These are auto-recorded on the
  bot side; on the client side, catch the library's typed errors and increment
  yourself:

  ```ts
  try {
    await user.sendMessage(peer, text);
  } catch (e) {
    metrics.increment(TELEGRAM_COUNTERS.API_ERRORS);
    if (e instanceof TelegramAuthError && e.code === 'FLOOD_WAIT')
      metrics.increment(TELEGRAM_COUNTERS.FLOOD_WAITS);
    throw e;
  }
  ```

- **Add a counter.** Add a member to `TELEGRAM_COUNTERS` in
  `common/observability/telegram-metrics.ts`; the snapshot/zeroing logic derives
  from the record automatically.
- **Custom tracer.** Implement `TelegramTracer.startActiveSpan` (e.g. for Datadog
  or a custom exporter) and override the tracer token — no OTel required.
