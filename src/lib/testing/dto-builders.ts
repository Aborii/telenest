/**
 * @file src/lib/testing/dto-builders.ts
 *
 * PURPOSE
 * -------
 * Lightweight DTO builder functions for the MTProto data-transfer types. Each
 * builder returns a sensible default object that satisfies the full interface,
 * and an optional `overrides` partial lets tests customize only the fields they
 * care about.
 *
 * These builders have **zero runtime dependencies** on GramJS or Telegraf, so
 * they work in any Jest/Vitest environment without any special setup.
 *
 * USAGE
 * -----
 * ```ts
 * import { aGramUser, aGramMessage, aGramDialog } from 'nestjs-telegram/testing';
 *
 * const me = aGramUser({ username: 'me', isPremium: true });
 * const msg = aGramMessage({ text: 'Hello!', out: true });
 * const chat = aGramDialog({ title: 'General', type: 'group' });
 * ```
 *
 * KEY EXPORTS
 * -----------
 * - aGramUser:    Builds a {@link GramUser} DTO with defaults.
 * - aGramMessage: Builds a {@link GramMessage} DTO with defaults.
 * - aGramDialog:  Builds a {@link GramDialog} DTO with defaults.
 */

import type { GramDialog, GramMessage, GramUser } from '../client/gram-client.types';

/**
 * Builds a {@link GramUser} DTO with sensible defaults. All fields required by
 * the interface are filled in; optional fields are omitted unless overridden.
 *
 * @param overrides - Partial fields to merge over the defaults.
 * @returns A complete {@link GramUser} object.
 * @throws Never.
 *
 * @example
 * ```ts
 * const bot = aGramUser({ isBot: true, username: 'my_bot' });
 * ```
 */
export function aGramUser(overrides: Partial<GramUser> = {}): GramUser {
  return {
    id: '1001',
    isSelf: false,
    isBot: false,
    isPremium: false,
    firstName: 'Test',
    username: 'testuser',
    ...overrides,
  };
}

/**
 * Builds a {@link GramMessage} DTO with sensible defaults. All required fields
 * are filled in; optional fields are omitted unless overridden.
 *
 * @param overrides - Partial fields to merge over the defaults.
 * @returns A complete {@link GramMessage} object.
 * @throws Never.
 *
 * @example
 * ```ts
 * const reply = aGramMessage({ text: 'World', out: false, senderId: '9999' });
 * ```
 */
export function aGramMessage(overrides: Partial<GramMessage> = {}): GramMessage {
  return {
    id: 1,
    peerId: '1001',
    text: 'Hello',
    date: 1700000000,
    out: false,
    ...overrides,
  };
}

/**
 * Builds a {@link GramDialog} DTO with sensible defaults. All required fields
 * are filled in; optional fields are omitted unless overridden.
 *
 * @param overrides - Partial fields to merge over the defaults.
 * @returns A complete {@link GramDialog} object.
 * @throws Never.
 *
 * @example
 * ```ts
 * const channel = aGramDialog({ title: 'News', type: 'channel', unreadCount: 5 });
 * ```
 */
export function aGramDialog(overrides: Partial<GramDialog> = {}): GramDialog {
  return {
    id: '2001',
    title: 'Test Chat',
    type: 'user',
    unreadCount: 0,
    pinned: false,
    ...overrides,
  };
}
