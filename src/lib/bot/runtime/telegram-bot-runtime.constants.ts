/**
 * @file src/lib/bot/runtime/telegram-bot-runtime.constants.ts
 *
 * PURPOSE
 * -------
 * Per-bot dependency-injection token helpers for the runtime-reconfigurable bot,
 * mirroring the static side's `./telegram-bot.tokens`. Each runtime registration
 * owns a {@link import('./telegram-bot-runtime.service').TelegramBotRuntime}
 * manager and its baseline options; these helpers compute the stable DI token for
 * each, given the bot's name, so multiple runtime bots (and runtime bots
 * alongside static ones) never collide.
 *
 * These helpers intentionally do **not** import the manager class, so they stay
 * free of import cycles and can be referenced from the module wiring and from
 * consumer code alike.
 *
 * USAGE
 * -----
 * ```ts
 * constructor(@InjectBotRuntime() private readonly bot: TelegramBotRuntime) {}
 * constructor(@InjectBotRuntime('admin') private readonly admin: TelegramBotRuntime) {}
 * ```
 *
 * KEY EXPORTS
 * -----------
 * - getBotRuntimeToken: DI token for a bot's `TelegramBotRuntime` manager.
 * - getBotRuntimeOptionsToken: DI token for a runtime bot's baseline options.
 * - InjectBotRuntime: parameter/property decorator injecting the manager by name.
 */

import { Inject, type InjectionToken } from '@nestjs/common';

import { DEFAULT_BOT_NAME } from '../telegram-bot.constants';

/** Token prefix for a runtime bot's {@link TelegramBotRuntime} manager. */
const RUNTIME_MANAGER_PREFIX = 'NESTJS_TELEGRAM_BOT_RUNTIME:';

/** Token prefix for a runtime bot's baseline ({@link TelegramBotRuntimeModuleOptions}). */
const RUNTIME_OPTIONS_PREFIX = 'NESTJS_TELEGRAM_BOT_RUNTIME_OPTIONS:';

/**
 * Resolves the DI token for a runtime bot's
 * {@link import('./telegram-bot-runtime.service').TelegramBotRuntime} manager —
 * the token {@link InjectBotRuntime} injects and the one `forRootRuntime`
 * registers the manager under.
 *
 * @param name - The bot name; omit (or pass the default name) for the default bot.
 * @returns A stable, name-derived string token.
 * @throws Never.
 *
 * @example
 * ```ts
 * const token = getBotRuntimeToken('admin'); // 'NESTJS_TELEGRAM_BOT_RUNTIME:admin'
 * ```
 */
export function getBotRuntimeToken(name?: string): InjectionToken {
  return `${RUNTIME_MANAGER_PREFIX}${name ?? DEFAULT_BOT_NAME}`;
}

/**
 * Resolves the DI token under which a runtime bot's baseline
 * {@link TelegramBotRuntimeModuleOptions} is registered. Internal wiring —
 * consumers inject the manager, not the options.
 *
 * @param name - The bot name; omit (or pass the default name) for the default bot.
 * @returns A stable, name-derived string token.
 * @throws Never.
 */
export function getBotRuntimeOptionsToken(name?: string): InjectionToken {
  return `${RUNTIME_OPTIONS_PREFIX}${name ?? DEFAULT_BOT_NAME}`;
}

/**
 * Parameter/property decorator that injects a runtime bot's
 * {@link import('./telegram-bot-runtime.service').TelegramBotRuntime} manager by
 * name — the runtime-mode counterpart of {@link import('../telegram-bot.tokens').InjectBot}.
 *
 * @param name - The bot name; omit (or pass the default name) for the default bot.
 * @returns A decorator equivalent to `@Inject(getBotRuntimeToken(name))`.
 * @throws Never.
 *
 * @example
 * ```ts
 * constructor(
 *   @InjectBotRuntime() private readonly bot: TelegramBotRuntime,
 *   @InjectBotRuntime('admin') private readonly admin: TelegramBotRuntime,
 * ) {}
 * ```
 */
export const InjectBotRuntime = (
  name?: string,
): PropertyDecorator & ParameterDecorator => Inject(getBotRuntimeToken(name));
