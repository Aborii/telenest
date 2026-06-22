/**
 * @file src/lib/testing/dto-builders.ts
 *
 * PURPOSE
 * -------
 * Framework-agnostic builders for the MTProto-side data-transfer objects
 * ({@link GramUser}, {@link GramMessage}, {@link GramDialog}). Each returns a
 * fully-typed DTO populated with sensible, network-free defaults, merged with
 * any per-test overrides. They let a consumer's test construct representative
 * fixtures in one call instead of hand-writing every field.
 *
 * These builders depend on **nothing** but the library's own DTO types — no
 * Jest, no Telegraf, no GramJS — so importing them never pulls a test runner or
 * an SDK into the module graph.
 *
 * USAGE
 * -----
 * ```ts
 * import { aGramUser, aGramMessage } from 'nestjs-telegram/testing';
 *
 * const me = aGramUser({ username: 'ada' });
 * const msg = aGramMessage({ text: 'hello', out: false });
 * ```
 *
 * KEY EXPORTS
 * -----------
 * - aGramUser: Builds a {@link GramUser} (the logged-in account by default).
 * - aGramMessage: Builds a {@link GramMessage} (an outgoing text message).
 * - aGramDialog: Builds a {@link GramDialog} (a one-to-one user conversation).
 */

import {
  GRAM_DIALOG_TYPES,
  type GramDialog,
  type GramMessage,
  type GramUser,
} from '../client/gram-client.types';

/**
 * Builds a representative {@link GramUser}. The defaults describe the logged-in
 * account itself (`isSelf: true`); pass `overrides` to model any other user.
 *
 * @param overrides - Fields to replace on the default user.
 * @returns A fully-typed {@link GramUser}.
 * @throws Never.
 * @example
 * ```ts
 * const bot = aGramUser({ isSelf: false, isBot: true, username: 'my_bot' });
 * ```
 */
export function aGramUser(overrides: Partial<GramUser> = {}): GramUser {
  return {
    id: '1000',
    isSelf: true,
    isBot: false,
    isPremium: false,
    firstName: 'Test',
    username: 'test_user',
    ...overrides,
  };
}

/**
 * Builds a representative {@link GramMessage}. The defaults describe a short
 * outgoing text message; pass `overrides` to model incoming or service messages.
 *
 * @param overrides - Fields to replace on the default message.
 * @returns A fully-typed {@link GramMessage}.
 * @throws Never.
 * @example
 * ```ts
 * const incoming = aGramMessage({ out: false, senderId: '2002', text: 'hi' });
 * ```
 */
export function aGramMessage(overrides: Partial<GramMessage> = {}): GramMessage {
  return {
    id: 1,
    peerId: '1000',
    text: 'test message',
    date: 1_700_000_000,
    out: true,
    ...overrides,
  };
}

/**
 * Builds a representative {@link GramDialog}. The defaults describe an unread-free
 * one-to-one user chat; pass `overrides` to model groups, channels, or unread
 * counts.
 *
 * @param overrides - Fields to replace on the default dialog.
 * @returns A fully-typed {@link GramDialog}.
 * @throws Never.
 * @example
 * ```ts
 * const channel = aGramDialog({ type: 'channel', title: 'News', unreadCount: 9 });
 * ```
 */
export function aGramDialog(overrides: Partial<GramDialog> = {}): GramDialog {
  return {
    id: '1000',
    title: 'Test Dialog',
    type: GRAM_DIALOG_TYPES.USER,
    unreadCount: 0,
    pinned: false,
    ...overrides,
  };
}
