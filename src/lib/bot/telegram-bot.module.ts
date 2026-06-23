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
  type TelegramMetrics,
  type TelegramMetricsRecorder,
  type TelegramTracer,
} from '../common';
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
  getBotToken,
  getBotTracerToken,
} from './telegram-bot.tokens';
import { TelegramEnhancerResolver } from './updates/execution/telegram-enhancer.resolver';
import { TelegramBotUpdatesRegistrar } from './updates/telegram-bot-updates.registrar';

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
    // ── Per-bot metrics sink (in-memory by default; readable via .snapshot()). ─
    {
      provide: metricsToken,
      useFactory: (): TelegramMetrics => new InMemoryTelegramMetrics(),
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
    // ── Discovery-based handler registrar, scoped to this bot by name. ────────
    {
      provide: getBotRegistrarToken(name),
      useFactory: (
        discovery: DiscoveryService,
        scanner: MetadataScanner,
        reflector: Reflector,
        enhancers: TelegramEnhancerResolver,
        bot: Telegraf,
      ): TelegramBotUpdatesRegistrar =>
        new TelegramBotUpdatesRegistrar(
          name,
          discovery,
          scanner,
          reflector,
          enhancers,
          bot,
        ),
      inject: [
        DiscoveryService,
        MetadataScanner,
        Reflector,
        TelegramEnhancerResolver,
        instanceToken,
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
    return withBotProviders(
      super.forRoot(options),
      options.name ?? DEFAULT_BOT_NAME,
    );
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
    return withBotProviders(
      super.forRootAsync(options),
      options.name ?? DEFAULT_BOT_NAME,
    );
  }
}
