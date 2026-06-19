/**
 * @file src/index.ts
 *
 * PURPOSE
 * -------
 * Public package entry point. Everything a consumer needs is re-exported here;
 * `package.json` points `main`/`types` at the compiled form of this file.
 *
 * USAGE
 * -----
 * import { TelegramBotModule, TelegramClientModule } from 'nestjs-telegram';
 */

export * from './lib';
