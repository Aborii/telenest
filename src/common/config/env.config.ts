/**
 * @file src/common/config/env.config.ts
 *
 * PURPOSE
 * -------
 * Helper functions that convert validated config values into Telegraf launch options.
 *
 * USAGE
 * -----
 * import { buildLaunchOptions } from './common/config/env.config';
 *
 * KEY EXPORTS
 * -----------
 * - buildLaunchOptions: Conditionally returns webhook launch options.
 */

import { Telegraf } from 'telegraf';

/**
 * Builds Telegraf launch options from optional webhook settings.
 *
 * @param domain - Public domain that Telegram can reach.
 * @param path - Relative webhook path mounted by Telegraf.
 * @returns Telegraf launch options when webhook settings are complete.
 * @throws {Error} If one webhook value is set without the other.
 */
export function buildLaunchOptions(
  domain?: string,
  path?: string,
): Telegraf.LaunchOptions | undefined {
  if (!domain && !path) return undefined;

  if (!domain || !path)
    throw new Error('Webhook configuration requires both domain and path.');

  return {
    webhook: {
      domain,
      path,
    },
  };
}
