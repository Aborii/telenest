/**
 * @file src/app.constants.ts
 *
 * PURPOSE
 * -------
 * Centralized constants for bot names and startup messages.
 *
 * USAGE
 * -----
 * import { BOT_NAMES } from './app.constants';
 *
 * KEY EXPORTS
 * -----------
 * - BOT_NAMES: Stable names for bot registration/injection.
 * - BotName: Union type derived from BOT_NAMES.
 */

/** Stable registry names for each Telegram bot instance. */
export const BOT_NAMES = {
  /** Name used by the echo bot registration. */
  ECHO: 'echo',
  /** Name used by the greeter bot registration. */
  GREETER: 'greeter',
} as const;

/** Union of all known bot names. */
export type BotName = (typeof BOT_NAMES)[keyof typeof BOT_NAMES];

/** App-level greeting emitted by the startup logger. */
export const APP_BOOT_MESSAGE = 'NestJS Telegram Bot Platform started.';
