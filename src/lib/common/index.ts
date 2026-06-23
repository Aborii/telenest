/**
 * @file src/lib/common/index.ts
 *
 * PURPOSE
 * -------
 * Barrel for the shared (cross-cutting) layer of the Telegram module.
 *
 * USAGE
 * -----
 * import { TelegramError, ParseMode } from '../common';
 */

export * from './observability';
export * from './telegram.errors';
export * from './telegram.types';
