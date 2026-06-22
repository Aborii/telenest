/**
 * @file src/lib/bot/updates/guards/index.ts
 *
 * PURPOSE
 * -------
 * Barrel for the built-in Bot API guards (allowlists and rate limiting).
 *
 * USAGE
 * -----
 * import { ChatAllowlistGuard, RateLimitGuard } from 'nestjs-telegram';
 */

export * from './chat-allowlist.guard';
export * from './user-allowlist.guard';
export * from './rate-limit.guard';
