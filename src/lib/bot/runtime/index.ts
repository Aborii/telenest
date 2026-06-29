/**
 * @file src/lib/bot/runtime/index.ts
 *
 * PURPOSE
 * -------
 * Barrel for the runtime-reconfigurable bot: the `TelegramBotRuntime` manager,
 * its public types/status union, and the per-bot DI token helpers. Re-exported
 * from the bot barrel so it is reachable via `telenest` and `telenest/bot`.
 *
 * KEY EXPORTS
 * -----------
 * - TelegramBotRuntime: the runtime bot lifecycle manager.
 * - getBotRuntimeToken / InjectBotRuntime: per-bot DI token helpers.
 * - Runtime status + options types.
 */

export * from './telegram-bot-runtime.constants';
export * from './telegram-bot-runtime.service';
export * from './telegram-bot-runtime.types';
