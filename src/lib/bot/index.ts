/**
 * @file src/lib/bot/index.ts
 *
 * PURPOSE
 * -------
 * Public barrel for the Bot API side of the library.
 *
 * USAGE
 * -----
 * import { TelegramBotModule, TelegramBotService } from 'nestjs-telegram';
 */

export * from './telegram-bot.constants';
export * from './telegram-bot.options';
export {
  TELEGRAM_BOT_OPTIONS,
  type TelegramBotModuleAsyncOptions,
  type TelegramBotModuleForRootOptions,
} from './telegram-bot.module-definition';
export * from './telegram-bot.service';
export * from './telegram-bot.module';
export * from './keyboard.builder';
export { createTelegrafInstance } from './telegram-bot.factory';
export * from './updates';
export * from './web-app';
