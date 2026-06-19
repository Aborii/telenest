/**
 * @file src/common/config/env.validation.ts
 *
 * PURPOSE
 * -------
 * Validates required environment variables before Nest modules are initialized.
 *
 * USAGE
 * -----
 * import { validateEnvironment } from './common/config/env.validation';
 *
 * ENVIRONMENT VARIABLES
 * ---------------------
 * - ECHO_BOT_TOKEN
 * - GREETER_BOT_TOKEN
 *
 * KEY EXPORTS
 * -----------
 * - AppEnvironment: Strongly-typed environment shape.
 * - validateEnvironment: ConfigModule validation callback.
 */

/** Runtime environment values required by this app. */
export interface AppEnvironment {
  /** Telegram token for the echo bot instance. */
  ECHO_BOT_TOKEN: string;
  /** Telegram token for the greeter bot instance. */
  GREETER_BOT_TOKEN: string;
  /** Optional webhook domain for the echo bot. */
  ECHO_BOT_WEBHOOK_DOMAIN?: string;
  /** Optional webhook path for the echo bot. */
  ECHO_BOT_WEBHOOK_PATH?: string;
  /** Optional webhook domain for the greeter bot. */
  GREETER_BOT_WEBHOOK_DOMAIN?: string;
  /** Optional webhook path for the greeter bot. */
  GREETER_BOT_WEBHOOK_PATH?: string;
}

/**
 * Asserts that a string-like env value is present and non-empty.
 *
 * @param rawValue - Raw value from process environment.
 * @param key - Environment variable name for diagnostic messages.
 * @returns A trimmed, non-empty string value.
 * @throws {Error} If value is missing or resolves to an empty string.
 */
function requireString(rawValue: unknown, key: string): string {
  if (typeof rawValue !== 'string')
    throw new Error(`Missing required environment variable: ${key}`);

  const normalized = rawValue.trim();
  if (!normalized)
    throw new Error(`Environment variable cannot be empty: ${key}`);

  return normalized;
}

/**
 * Validates and normalizes environment variables for ConfigModule.
 *
 * @param config - Raw environment object provided by ConfigModule.
 * @returns Typed and normalized environment values.
 * @throws {Error} If required variables are missing or invalid.
 */
export function validateEnvironment(config: Record<string, unknown>): AppEnvironment {
  return {
    ECHO_BOT_TOKEN: requireString(config.ECHO_BOT_TOKEN, 'ECHO_BOT_TOKEN'),
    GREETER_BOT_TOKEN: requireString(config.GREETER_BOT_TOKEN, 'GREETER_BOT_TOKEN'),
    ECHO_BOT_WEBHOOK_DOMAIN:
      typeof config.ECHO_BOT_WEBHOOK_DOMAIN === 'string'
        ? config.ECHO_BOT_WEBHOOK_DOMAIN.trim() || undefined
        : undefined,
    ECHO_BOT_WEBHOOK_PATH:
      typeof config.ECHO_BOT_WEBHOOK_PATH === 'string'
        ? config.ECHO_BOT_WEBHOOK_PATH.trim() || undefined
        : undefined,
    GREETER_BOT_WEBHOOK_DOMAIN:
      typeof config.GREETER_BOT_WEBHOOK_DOMAIN === 'string'
        ? config.GREETER_BOT_WEBHOOK_DOMAIN.trim() || undefined
        : undefined,
    GREETER_BOT_WEBHOOK_PATH:
      typeof config.GREETER_BOT_WEBHOOK_PATH === 'string'
        ? config.GREETER_BOT_WEBHOOK_PATH.trim() || undefined
        : undefined,
  };
}
