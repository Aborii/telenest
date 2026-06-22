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
 * - InjectBot: parameter/property decorator injecting a bot's facade by name.
 */

import { Inject, type InjectionToken } from '@nestjs/common';

import { DEFAULT_BOT_NAME, TELEGRAM_BOT } from './telegram-bot.constants';
import { TelegramBotService } from './telegram-bot.service';
import { TelegramBotUpdatesRegistrar } from './updates/telegram-bot-updates.registrar';

/** Token prefix for a named bot's raw `Telegraf` instance. */
const NAMED_BOT_INSTANCE_PREFIX = 'NESTJS_TELEGRAM_BOT_INSTANCE:';

/** Token prefix for a named bot's `TelegramBotService` facade. */
const NAMED_BOT_SERVICE_PREFIX = 'NESTJS_TELEGRAM_BOT_SERVICE:';

/** Token prefix for a named bot's update registrar. */
const NAMED_BOT_REGISTRAR_PREFIX = 'NESTJS_TELEGRAM_BOT_REGISTRAR:';

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
