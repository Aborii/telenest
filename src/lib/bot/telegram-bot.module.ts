/**
 * @file src/lib/bot/telegram-bot.module.ts
 *
 * PURPOSE
 * -------
 * Dynamic Nest module that wires the Bot API side of the library. Each
 * `forRoot` / `forRootAsync` call registers **one** bot: it builds that bot's
 * `Telegraf` instance from the supplied options, exposes the typed
 * {@link TelegramBotService} facade, and stands up a discovery-based handler
 * registrar scoped to the bot.
 *
 * Call it more than once with distinct `name`s to run **multiple bots** in a
 * single application. Every per-bot provider is registered under a name-derived
 * token (see `./telegram-bot.tokens`), and each registration is an isolated Nest
 * module instance with its own options — so two bots never collide on tokens or
 * configuration. The default (unnamed) bot keeps its legacy tokens
 * (`TELEGRAM_BOT`, the `TelegramBotService` class) for backward compatibility.
 *
 * USAGE
 * -----
 * ```ts
 * // Single (default) bot — unchanged.
 * @Module({ imports: [TelegramBotModule.forRoot({ token: process.env.BOT_TOKEN! })] })
 * export class AppModule {}
 *
 * // Multiple named bots.
 * @Module({
 *   imports: [
 *     TelegramBotModule.forRoot({ name: 'notify', token: process.env.NOTIFY_TOKEN! }),
 *     TelegramBotModule.forRootAsync({
 *       name: 'support',
 *       inject: [ConfigService],
 *       useFactory: (c: ConfigService) => ({ token: c.getOrThrow('SUPPORT_TOKEN') }),
 *     }),
 *   ],
 * })
 * export class AppModule {}
 *
 * // Inject by name:
 * constructor(@InjectBot('notify') private readonly notify: TelegramBotService) {}
 * ```
 *
 * KEY EXPORTS
 * -----------
 * - TelegramBotModule: The dynamic module with name-aware `forRoot`/`forRootAsync`.
 */

import {
  Module,
  type DynamicModule,
  type InjectionToken,
  type Provider,
} from '@nestjs/common';
import {
  DiscoveryModule,
  DiscoveryService,
  MetadataScanner,
  Reflector,
} from '@nestjs/core';
import type { Telegraf } from 'telegraf';

import {
  InMemoryTelegramMetrics,
  NOOP_TELEGRAM_TRACER,
  type TelegramMetricsRecorder,
  type TelegramTracer,
} from '../common';
import {
  getBotRuntimeOptionsToken,
  getBotRuntimeToken,
} from './runtime/telegram-bot-runtime.constants';
import { TelegramBotRuntime } from './runtime/telegram-bot-runtime.service';
import type {
  TelegramBotRuntimeForRootOptions,
  TelegramBotRuntimeModuleOptions,
} from './runtime/telegram-bot-runtime.types';
import { TelegramBotScenesRegistrar } from './scenes/telegram-bot-scenes.registrar';
import { DEFAULT_BOT_NAME } from './telegram-bot.constants';
import { createTelegrafInstance } from './telegram-bot.factory';
import { TelegramBotHealthIndicator } from './telegram-bot.health';
import {
  ConfigurableModuleClass,
  TELEGRAM_BOT_OPTIONS,
  type TelegramBotModuleAsyncOptions,
  type TelegramBotModuleForRootOptions,
} from './telegram-bot.module-definition';
import type { TelegramBotModuleOptions } from './telegram-bot.options';
import { TelegramBotService } from './telegram-bot.service';
import {
  getBotHealthToken,
  getBotInstanceToken,
  getBotMetricsToken,
  getBotRegistrarToken,
  getBotScenesRegistrarToken,
  getBotToken,
  getBotTracerToken,
} from './telegram-bot.tokens';
import { TelegramEnhancerResolver } from './updates/execution/telegram-enhancer.resolver';
import { TelegramBotUpdatesRegistrar } from './updates/telegram-bot-updates.registrar';
import {
  TELEGRAM_WEBHOOK_BOT,
  TELEGRAM_WEBHOOK_OPTIONS,
} from './webhook/telegram-webhook.constants';
import { createTelegramWebhookController } from './webhook/telegram-webhook.controller';
import { TelegramWebhookGuard } from './webhook/telegram-webhook.guard';
import {
  assertValidWebhookOptions,
  normalizeWebhookPath,
} from './webhook/telegram-webhook.helpers';
import type { TelegramBotWebhookOptions } from './webhook/telegram-webhook.options';
import { TelegramWebhookRegistrar } from './webhook/telegram-webhook.registrar';

/**
 * Builds the three DI providers one (named) bot needs: its raw `Telegraf`
 * instance, its typed {@link TelegramBotService} facade, and its update
 * registrar. All three read the module-local `TELEGRAM_BOT_OPTIONS`, so each
 * registration stays isolated, and each is provided under a per-name token so
 * multiple bots never collide.
 *
 * The facade and registrar are provided via factories (not `useClass`) so the
 * per-bot instance and options can be passed explicitly — the same reason the
 * service is constructable directly in tests. The registrar additionally receives
 * the {@link TelegramEnhancerResolver}, which resolves each handler's
 * guards/interceptors/exception filters declared via the `@UseTelegram*`
 * decorators.
 *
 * @param name - The bot's name (`DEFAULT_BOT_NAME` for the default bot).
 * @returns The provider set for this bot.
 * @throws Never.
 */
function createBotProviders(name: string): Provider[] {
  const instanceToken = getBotInstanceToken(name);
  const metricsToken = getBotMetricsToken(name);
  const tracerToken = getBotTracerToken(name);
  const facadeToken = getBotToken(name);
  return [
    // ── Raw Telegraf instance, built from this registration's options. ────────
    {
      provide: instanceToken,
      useFactory: (options: TelegramBotModuleOptions): Telegraf =>
        createTelegrafInstance(options),
      inject: [TELEGRAM_BOT_OPTIONS],
    },
    // ── Per-bot metrics sink: the configured recorder, else an in-memory one
    //    (readable via .snapshot()). Swap it (e.g. an OTel bridge) via options. ─
    {
      provide: metricsToken,
      useFactory: (
        options: TelegramBotModuleOptions,
      ): TelegramMetricsRecorder =>
        options.metrics ?? new InMemoryTelegramMetrics(),
      inject: [TELEGRAM_BOT_OPTIONS],
    },
    // ── Per-bot tracer; no-op by default (override to emit OpenTelemetry spans). ─
    { provide: tracerToken, useValue: NOOP_TELEGRAM_TRACER },
    // ── Typed facade over that instance (manages its own launch/stop). ────────
    {
      provide: facadeToken,
      useFactory: (
        bot: Telegraf,
        options: TelegramBotModuleOptions,
        metrics: TelegramMetricsRecorder,
        tracer: TelegramTracer,
      ): TelegramBotService =>
        new TelegramBotService(bot, options, metrics, tracer),
      inject: [instanceToken, TELEGRAM_BOT_OPTIONS, metricsToken, tracerToken],
    },
    // ── Health indicator probing bot reachability for a terminus endpoint. ────
    {
      provide: getBotHealthToken(name),
      useFactory: (bot: TelegramBotService): TelegramBotHealthIndicator =>
        new TelegramBotHealthIndicator(bot),
      inject: [facadeToken],
    },
    // ── Resolves a handler's guard/interceptor/filter refs (DI + @Catch). ─────
    TelegramEnhancerResolver,
    // ── Discovery-based scene/wizard registrar, scoped to this bot by name. ───
    {
      provide: getBotScenesRegistrarToken(name),
      useFactory: (
        discovery: DiscoveryService,
        scanner: MetadataScanner,
        reflector: Reflector,
        enhancers: TelegramEnhancerResolver,
        bot: Telegraf,
        options: TelegramBotModuleOptions,
      ): TelegramBotScenesRegistrar =>
        new TelegramBotScenesRegistrar(
          name,
          discovery,
          scanner,
          reflector,
          enhancers,
          bot,
          options,
        ),
      inject: [
        DiscoveryService,
        MetadataScanner,
        Reflector,
        TelegramEnhancerResolver,
        instanceToken,
        TELEGRAM_BOT_OPTIONS,
      ],
    },
    // ── Discovery-based handler registrar, scoped to this bot by name. It owns
    //    bootstrap ordering: it registers scenes (session + Stage) between the
    //    @Use() global middleware and the terminal handlers. ───────────────────
    {
      provide: getBotRegistrarToken(name),
      useFactory: (
        discovery: DiscoveryService,
        scanner: MetadataScanner,
        reflector: Reflector,
        enhancers: TelegramEnhancerResolver,
        bot: Telegraf,
        options: TelegramBotModuleOptions,
        scenes: TelegramBotScenesRegistrar,
      ): TelegramBotUpdatesRegistrar =>
        new TelegramBotUpdatesRegistrar(
          name,
          discovery,
          scanner,
          reflector,
          enhancers,
          bot,
          options,
          scenes,
        ),
      inject: [
        DiscoveryService,
        MetadataScanner,
        Reflector,
        TelegramEnhancerResolver,
        instanceToken,
        TELEGRAM_BOT_OPTIONS,
        getBotScenesRegistrarToken(name),
      ],
    },
  ];
}

/**
 * The tokens a bot exports to consumers: its facade and its raw instance. The
 * internal registrar is intentionally not exported.
 *
 * @param name - The bot's name (`DEFAULT_BOT_NAME` for the default bot).
 * @returns The exported tokens for this bot.
 * @throws Never.
 */
function createBotExports(name: string): InjectionToken[] {
  return [
    getBotToken(name),
    getBotInstanceToken(name),
    getBotMetricsToken(name),
    getBotTracerToken(name),
    getBotHealthToken(name),
  ];
}

/**
 * Appends one bot's providers and exports onto a generated dynamic module.
 *
 * @param dynamicModule - The dynamic module produced by the base
 *   `ConfigurableModuleClass` (it carries the options provider and global flag).
 * @param name - The bot's name.
 * @returns The dynamic module augmented with this bot's providers/exports.
 * @throws Never.
 */
function withBotProviders(
  dynamicModule: DynamicModule,
  name: string,
): DynamicModule {
  return {
    ...dynamicModule,
    providers: [
      ...(dynamicModule.providers ?? []),
      ...createBotProviders(name),
    ],
    exports: [...(dynamicModule.exports ?? []), ...createBotExports(name)],
  };
}

/**
 * Augments a dynamic module with the built-in webhook controller for one bot:
 * a path-bound controller (`POST {path}`), the secret-token guard, the bootstrap
 * registrar, and the two per-registration alias providers the latter two read
 * (`TELEGRAM_WEBHOOK_OPTIONS` and `TELEGRAM_WEBHOOK_BOT`, the latter pointing at
 * this bot's already-registered `Telegraf` instance).
 *
 * All four providers live in this single module instance, so for multiple named
 * bots each gets its own controller, guard, and registrar resolving its own
 * options and bot — the same isolation `withBotProviders` relies on.
 *
 * @param dynamicModule - The module already carrying this bot's core providers.
 * @param name - The bot's name (`DEFAULT_BOT_NAME` for the default bot).
 * @param webhook - The validated webhook options for this registration.
 * @returns The dynamic module augmented with the webhook controller + providers.
 * @throws {import('../common').TelegramConfigError} If the webhook options are
 *   structurally invalid (empty `path`, or `registerOnBootstrap` without a valid
 *   `domain`) — surfaced synchronously, at registration.
 */
function withWebhook(
  dynamicModule: DynamicModule,
  name: string,
  webhook: TelegramBotWebhookOptions,
): DynamicModule {
  // ── Fail fast at registration rather than as a confusing runtime error. ─────
  assertValidWebhookOptions(webhook);
  // ── Canonicalize the path once so the controller route and the URL registered
  //    with Telegram (joinWebhookUrl, via the options below) cannot diverge. ───
  const normalized: TelegramBotWebhookOptions = {
    ...webhook,
    path: normalizeWebhookPath(webhook.path),
  };
  return {
    ...dynamicModule,
    controllers: [
      ...(dynamicModule.controllers ?? []),
      createTelegramWebhookController(normalized.path),
    ],
    providers: [
      ...(dynamicModule.providers ?? []),
      { provide: TELEGRAM_WEBHOOK_OPTIONS, useValue: normalized },
      // ── Stable alias so the controller/registrar inject one token whether
      //    this is the default bot (TELEGRAM_BOT) or a named bot. ─────────────
      { provide: TELEGRAM_WEBHOOK_BOT, useExisting: getBotInstanceToken(name) },
      TelegramWebhookGuard,
      TelegramWebhookRegistrar,
    ],
  };
}

/**
 * Builds the DI providers a **runtime** (token-after-boot) bot needs: its baseline
 * options, its metrics sink and tracer, the enhancer resolver, and the
 * {@link TelegramBotRuntime} manager itself — each under the same per-name tokens
 * the static path uses, so a runtime bot coexists with static and other runtime
 * bots without collision.
 *
 * Unlike {@link createBotProviders}, no `Telegraf` instance, facade, or registrar
 * is wired here: the manager constructs (and rebinds) those on demand from the
 * token supplied at {@link TelegramBotRuntime.configure} time.
 *
 * @param name - The bot's name (`DEFAULT_BOT_NAME` for the default runtime bot).
 * @param options - The baseline runtime options from `forRootRuntime`.
 * @returns The provider set for this runtime bot.
 * @throws Never.
 */
function createRuntimeProviders(
  name: string,
  options: TelegramBotRuntimeModuleOptions,
): Provider[] {
  const optionsToken = getBotRuntimeOptionsToken(name);
  const metricsToken = getBotMetricsToken(name);
  const tracerToken = getBotTracerToken(name);
  return [
    // ── Baseline options every configure() merges its overrides onto. ─────────
    { provide: optionsToken, useValue: options },
    // ── Per-bot metrics sink (configured recorder, else in-memory). ───────────
    {
      provide: metricsToken,
      useFactory: (
        opts: TelegramBotRuntimeModuleOptions,
      ): TelegramMetricsRecorder =>
        opts.metrics ?? new InMemoryTelegramMetrics(),
      inject: [optionsToken],
    },
    // ── Per-bot tracer; no-op by default. ─────────────────────────────────────
    { provide: tracerToken, useValue: NOOP_TELEGRAM_TRACER },
    // ── Resolves a handler's guard/interceptor/filter refs (DI + @Catch). ─────
    TelegramEnhancerResolver,
    // ── The runtime manager: builds/rebinds/launches the bot on demand. ───────
    {
      provide: getBotRuntimeToken(name),
      useFactory: (
        opts: TelegramBotRuntimeModuleOptions,
        discovery: DiscoveryService,
        scanner: MetadataScanner,
        reflector: Reflector,
        enhancers: TelegramEnhancerResolver,
        metrics: TelegramMetricsRecorder,
        tracer: TelegramTracer,
      ): TelegramBotRuntime =>
        new TelegramBotRuntime(
          name,
          opts,
          discovery,
          scanner,
          reflector,
          enhancers,
          metrics,
          tracer,
        ),
      inject: [
        optionsToken,
        DiscoveryService,
        MetadataScanner,
        Reflector,
        TelegramEnhancerResolver,
        metricsToken,
        tracerToken,
      ],
    },
  ];
}

/**
 * Bot API feature module. Extends the generated `ConfigurableModuleClass` to
 * inherit fully-typed `forRoot` / `forRootAsync`, then augments their output
 * with this library's per-bot providers (instance, facade, registrar).
 *
 * `DiscoveryModule` powers the decorator-based handler system
 * (`@TelegramUpdate`/`@Command`/…): each bot's registrar binds its discovered,
 * name-matched handlers onto its `Telegraf` at bootstrap, before launch.
 */
@Module({ imports: [DiscoveryModule] })
export class TelegramBotModule extends ConfigurableModuleClass {
  /**
   * Registers a bot synchronously. Pass `name` to register one of several bots;
   * omit it for the single default bot.
   *
   * @param options - Bot options plus the `isGlobal` / `name` extras.
   * @returns A dynamic module wiring this bot's instance, facade, and registrar.
   * @throws {import('../common').TelegramConfigError} Lazily, at provider
   *   construction, if the bot token is empty.
   */
  public static forRoot(
    options: TelegramBotModuleForRootOptions,
  ): DynamicModule {
    const name = options.name ?? DEFAULT_BOT_NAME;
    const dynamicModule = withBotProviders(super.forRoot(options), name);
    return options.webhook
      ? withWebhook(dynamicModule, name, options.webhook)
      : dynamicModule;
  }

  /**
   * Registers a bot asynchronously (`useFactory` / `useClass` / `useExisting`).
   * `name` is a synchronous sibling of the async options — it must be known up
   * front to compute the per-bot tokens — so it sits alongside the factory, not
   * inside its resolved result.
   *
   * @param options - Async options plus the `isGlobal` / `name` extras.
   * @returns A dynamic module wiring this bot's instance, facade, and registrar.
   * @throws {import('../common').TelegramConfigError} Lazily, at provider
   *   construction, if the resolved bot token is empty.
   */
  public static forRootAsync(
    options: TelegramBotModuleAsyncOptions,
  ): DynamicModule {
    const name = options.name ?? DEFAULT_BOT_NAME;
    const dynamicModule = withBotProviders(super.forRootAsync(options), name);
    return options.webhook
      ? withWebhook(dynamicModule, name, options.webhook)
      : dynamicModule;
  }

  /**
   * Registers a **runtime-reconfigurable** bot whose token is supplied (and may be
   * rotated or cleared) *after* application bootstrap, via the injectable
   * {@link TelegramBotRuntime} manager — rather than required at `forRoot` time.
   *
   * No `Telegraf` instance is built at registration: nothing connects to Telegram
   * until the first {@link TelegramBotRuntime.configure} call, so a missing token
   * never crashes bootstrap. Decorator handlers, guards, filters, and scenes are
   * discovered and re-bound onto each instance the manager builds, scoped to this
   * registration's `name`. This is additive — it does not affect `forRoot` /
   * `forRootAsync`.
   *
   * @param options - Baseline runtime options plus the `isGlobal` / `name` extras.
   * @returns A dynamic module wiring this bot's {@link TelegramBotRuntime} manager.
   * @throws Never (a bad token is reported as `error` status at `configure` time,
   *   never thrown from registration).
   *
   * @example
   * ```ts
   * @Module({ imports: [TelegramBotModule.forRootRuntime({ isGlobal: true })] })
   * export class AppModule {}
   *
   * // later:
   * constructor(@InjectBotRuntime() private readonly bot: TelegramBotRuntime) {}
   * await this.bot.configure({ token: tokenFromDb });
   * ```
   */
  public static forRootRuntime(
    options: TelegramBotRuntimeForRootOptions = {},
  ): DynamicModule {
    const { isGlobal, name: rawName, ...baseOptions } = options;
    const name = rawName ?? DEFAULT_BOT_NAME;
    return {
      module: TelegramBotModule,
      global: isGlobal,
      providers: createRuntimeProviders(name, baseOptions),
      exports: [
        getBotRuntimeToken(name),
        getBotMetricsToken(name),
        getBotTracerToken(name),
      ],
    };
  }
}
