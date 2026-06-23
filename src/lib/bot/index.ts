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

export * from './callback-data.codec';
export * from './keyboard.builder';
export * from './message-splitter';
export * from './retry';
export * from './telegram-bot.constants';
export { createTelegrafInstance } from './telegram-bot.factory';
export * from './telegram-bot.health';
export * from './telegram-bot.metrics-middleware';
export * from './telegram-bot.module';
export {
  TELEGRAM_BOT_OPTIONS,
  type TelegramBotModuleAsyncOptions,
  type TelegramBotModuleForRootOptions,
} from './telegram-bot.module-definition';
export * from './telegram-bot.options';
export * from './telegram-bot.service';
export {
  getBotHealthToken,
  getBotInstanceToken,
  getBotMetricsToken,
  getBotToken,
  getBotTracerToken,
  InjectBot,
} from './telegram-bot.tokens';
export * from './updates';
export * from './web-app';
