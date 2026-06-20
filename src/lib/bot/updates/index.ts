/**
 * @file src/lib/bot/updates/index.ts
 *
 * PURPOSE
 * -------
 * Public barrel for the Bot API decorator-based update system: the class/method
 * decorators, parameter decorators, shared types, and the registrar.
 *
 * USAGE
 * -----
 * import { TelegramUpdate, Start, Command, Ctx } from 'nestjs-telegram';
 */

export * from './telegram-update.types';
export * from './telegram-update.decorator';
export * from './param.decorators';
export { resolveHandlerArguments } from './argument-resolver';
export { TelegramBotUpdatesRegistrar } from './telegram-bot-updates.registrar';
