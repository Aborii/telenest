/**
 * @file src/lib/index.ts
 *
 * PURPOSE
 * -------
 * Aggregated barrel for the entire library. Re-exports the common layer, the
 * Bot API module, the MTProto module, and the umbrella module.
 *
 * USAGE
 * -----
 * import { TelegramBotModule, TelegramClientModule, TelegramModule } from 'nestjs-telegram';
 */

export * from './bot';
export * from './client';
export * from './common';
export * from './telegram.module';
