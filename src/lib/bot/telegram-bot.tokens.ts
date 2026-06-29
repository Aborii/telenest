/**
 * @file src/lib/bot/telegram-bot.tokens.ts
 *
 * PURPOSE
 * -------
 * Per-bot dependency-injection token helpers that make multiple named bots
 * possible in one application. Each registered bot owns three providers — its
 * raw `Telegraf` instance, its {@link TelegramBotService} facade, and its update
 * registrar — and these helpers compute the stable DI token for each, given the
 * bot's name.
 *
 * The **default** (unnamed) bot keeps its original, legacy tokens for full
 * backward compatibility: the `TELEGRAM_BOT` symbol for the instance and the
 * `TelegramBotService` class itself for the facade. Named bots get distinct
 * string tokens derived from the name, so two registrations never collide.
 *
 * USAGE
 * -----
 * ```ts
 * // Inject a named bot's typed facade:
 * constructor(@InjectBot('notify') private readonly notify: TelegramBotService) {}
 *
 * // Inject the default bot's facade (unchanged):
 * constructor(@InjectBot() private readonly bot: TelegramBotService) {}
 *
 * // Grab a named bot's raw Telegraf instance:
 * constructor(@Inject(getBotInstanceToken('notify')) private readonly raw: Telegraf) {}
 * ```
 *
 * KEY EXPORTS
 * -----------
 * - getBotToken: DI token for a bot's `TelegramBotService` facade.
 * - getBotInstanceToken: DI token for a bot's raw `Telegraf` instance.
 * - getBotRegistrarToken: DI token for a bot's update registrar (internal).
 * - getBotMetricsToken / getBotTracerToken: tokens for a bot's metrics/tracer.
 * - getBotHealthToken: DI token for a bot's health indicator.
 * - InjectBot: parameter/property decorator injecting a bot's facade by name.
 */

import { Inject, type InjectionToken } from '@nestjs/common';

import { TelegramBotScenesRegistrar } from './scenes/telegram-bot-scenes.registrar';
import {
  DEFAULT_BOT_NAME,
  TELEGRAM_BOT,
  TELEGRAM_BOT_METRICS,
  TELEGRAM_BOT_TRACER,
} from './telegram-bot.constants';
import { TelegramBotHealthIndicator } from './telegram-bot.health';
import { TelegramBotService } from './telegram-bot.service';
import { TelegramBotUpdatesRegistrar } from './updates/telegram-bot-updates.registrar';

/** Token prefix for a named bot's raw `Telegraf` instance. */
const NAMED_BOT_INSTANCE_PREFIX = 'NESTJS_TELEGRAM_BOT_INSTANCE:';

/** Token prefix for a named bot's `TelegramBotService` facade. */
const NAMED_BOT_SERVICE_PREFIX = 'NESTJS_TELEGRAM_BOT_SERVICE:';

/** Token prefix for a named bot's update registrar. */
const NAMED_BOT_REGISTRAR_PREFIX = 'NESTJS_TELEGRAM_BOT_REGISTRAR:';

/** Token prefix for a named bot's scenes registrar. */
const NAMED_BOT_SCENES_REGISTRAR_PREFIX =
  'NESTJS_TELEGRAM_BOT_SCENES_REGISTRAR:';

/** Token prefix for a named bot's metrics surface. */
const NAMED_BOT_METRICS_PREFIX = 'NESTJS_TELEGRAM_BOT_METRICS:';

/** Token prefix for a named bot's tracer. */
const NAMED_BOT_TRACER_PREFIX = 'NESTJS_TELEGRAM_BOT_TRACER:';

/** Token prefix for a named bot's health indicator. */
const NAMED_BOT_HEALTH_PREFIX = 'NESTJS_TELEGRAM_BOT_HEALTH:';

/**
 * Whether `name` refers to the default bot (unset, or the default sentinel).
 *
 * @param name - The bot name to test.
 * @returns `true` for the default bot; `false` for a named bot.
 * @throws Never.
 */
function isDefaultBot(name?: string): boolean {
  return !name || name === DEFAULT_BOT_NAME;
}

/**
 * Resolves the DI token for a bot's {@link TelegramBotService} facade. This is
 * the token {@link InjectBot} uses, and the one `TelegramBotModule` registers the
 * facade under.
 *
 * @param name - The bot name; omit (or pass the default name) for the default bot.
 * @returns The `TelegramBotService` class for the default bot, else a name-derived
 *   string token.
 * @throws Never.
 *
 * @example
 * ```ts
 * const token = getBotToken('notify'); // 'NESTJS_TELEGRAM_BOT_SERVICE:notify'
 * ```
 */
export function getBotToken(name?: string): InjectionToken {
  return isDefaultBot(name)
    ? TelegramBotService
    : `${NAMED_BOT_SERVICE_PREFIX}${name}`;
}

/**
 * Resolves the DI token for a bot's raw `Telegraf` instance — the lower-level
 * escape hatch beneath the {@link TelegramBotService} facade.
 *
 * @param name - The bot name; omit (or pass the default name) for the default bot.
 * @returns The `TELEGRAM_BOT` symbol for the default bot, else a name-derived
 *   string token.
 * @throws Never.
 *
 * @example
 * ```ts
 * @Inject(getBotInstanceToken('notify')) private readonly raw: Telegraf;
 * ```
 */
export function getBotInstanceToken(name?: string): InjectionToken {
  return isDefaultBot(name)
    ? TELEGRAM_BOT
    : `${NAMED_BOT_INSTANCE_PREFIX}${name}`;
}

/**
 * Resolves the DI token for a bot's update registrar. Internal wiring — consumers
 * never inject the registrar directly.
 *
 * @param name - The bot name; omit (or pass the default name) for the default bot.
 * @returns The `TelegramBotUpdatesRegistrar` class for the default bot, else a
 *   name-derived string token.
 * @throws Never.
 */
export function getBotRegistrarToken(name?: string): InjectionToken {
  return isDefaultBot(name)
    ? TelegramBotUpdatesRegistrar
    : `${NAMED_BOT_REGISTRAR_PREFIX}${name}`;
}

/**
 * Resolves the DI token for a bot's scenes registrar (builds + registers its
 * `@Scene`/`@WizardScene` providers). Internal wiring — the update registrar
 * injects it to register scenes at the right point in bootstrap; consumers never
 * inject it directly.
 *
 * @param name - The bot name; omit (or pass the default name) for the default bot.
 * @returns The `TelegramBotScenesRegistrar` class for the default bot, else a
 *   name-derived string token.
 * @throws Never.
 */
export function getBotScenesRegistrarToken(name?: string): InjectionToken {
  return isDefaultBot(name)
    ? TelegramBotScenesRegistrar
    : `${NAMED_BOT_SCENES_REGISTRAR_PREFIX}${name}`;
}

/**
 * Resolves the DI token for a bot's {@link import('../common').TelegramMetrics}
 * surface — inject it to read the bot's counters via `.snapshot()`.
 *
 * @param name - The bot name; omit (or pass the default name) for the default bot.
 * @returns The `TELEGRAM_BOT_METRICS` symbol for the default bot, else a
 *   name-derived string token.
 * @throws Never.
 */
export function getBotMetricsToken(name?: string): InjectionToken {
  return isDefaultBot(name)
    ? TELEGRAM_BOT_METRICS
    : `${NAMED_BOT_METRICS_PREFIX}${name}`;
}

/**
 * Resolves the DI token for a bot's {@link import('../common').TelegramTracer}.
 * Override this provider to emit OpenTelemetry spans around Bot API calls.
 *
 * @param name - The bot name; omit (or pass the default name) for the default bot.
 * @returns The `TELEGRAM_BOT_TRACER` symbol for the default bot, else a
 *   name-derived string token.
 * @throws Never.
 */
export function getBotTracerToken(name?: string): InjectionToken {
  return isDefaultBot(name)
    ? TELEGRAM_BOT_TRACER
    : `${NAMED_BOT_TRACER_PREFIX}${name}`;
}

/**
 * Resolves the DI token for a bot's
 * {@link import('./telegram-bot.health').TelegramBotHealthIndicator}.
 *
 * @param name - The bot name; omit (or pass the default name) for the default bot.
 * @returns The `TelegramBotHealthIndicator` class for the default bot, else a
 *   name-derived string token.
 * @throws Never.
 */
export function getBotHealthToken(name?: string): InjectionToken {
  return isDefaultBot(name)
    ? TelegramBotHealthIndicator
    : `${NAMED_BOT_HEALTH_PREFIX}${name}`;
}

/**
 * Parameter/property decorator that injects a bot's {@link TelegramBotService}
 * facade by name — the typed multi-bot counterpart of injecting
 * `TelegramBotService` directly.
 *
 * @param name - The bot name; omit (or pass the default name) for the default bot.
 * @returns A decorator equivalent to `@Inject(getBotToken(name))`.
 * @throws Never.
 *
 * @example
 * ```ts
 * constructor(
 *   @InjectBot('notify') private readonly notify: TelegramBotService,
 *   @InjectBot('support') private readonly support: TelegramBotService,
 * ) {}
 * ```
 */
export const InjectBot = (
  name?: string,
): PropertyDecorator & ParameterDecorator => Inject(getBotToken(name));
