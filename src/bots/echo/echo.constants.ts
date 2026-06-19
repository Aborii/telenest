/**
 * @file src/bots/echo/echo.constants.ts
 *
 * PURPOSE
 * -------
 * Shared text constants and trigger lists used by echo update handlers.
 *
 * USAGE
 * -----
 * import { ECHO_GREETINGS } from './echo.constants';
 */

/** Greetings recognized by the echo bot for welcome replies. */
export const ECHO_GREETINGS = ['hi', 'hello', 'hey', 'yo'] as const;

/** Short prompt shown by /start and /help handlers. */
export const ECHO_HELP_TEXT =
  'Send any text and I will echo it back. Try: hello, reverse <text>.';
