/**
 * @file src/lib/bot/updates/index.ts
 *
 * PURPOSE
 * -------
 * Public barrel for the Bot API decorator-based update system: the class/method
 * decorators, parameter decorators, shared types, the registrar, and the
 * enhancer layer (guards, interceptors, exception filters) with its built-ins.
 *
 * USAGE
 * -----
 * import { TelegramUpdate, Start, Command, Ctx, UseTelegramGuards } from 'nestjs-telegram';
 */

export { resolveHandlerArguments } from './argument-resolver';
export * from './execution';
export * from './filters';
export * from './guards';
export * from './param.decorators';
export { TelegramBotUpdatesRegistrar } from './telegram-bot-updates.registrar';
export * from './telegram-update.decorator';
export * from './telegram-update.types';
