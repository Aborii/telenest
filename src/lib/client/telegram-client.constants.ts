/**
 * @file src/lib/client/telegram-client.constants.ts
 *
 * PURPOSE
 * -------
 * Dependency-injection tokens for the MTProto (user account) side of the
 * library.
 *
 * USAGE
 * -----
 * ```ts
 * import { Inject } from '@nestjs/common';
 * import { TELEGRAM_GRAM_CLIENT, IGramClient } from 'nestjs-telegram';
 *
 * constructor(@Inject(TELEGRAM_GRAM_CLIENT) private readonly client: IGramClient) {}
 * ```
 *
 * KEY EXPORTS
 * -----------
 * - TELEGRAM_GRAM_CLIENT: Resolves to the connected `IGramClient` instance.
 * - TELEGRAM_SESSION_STORE: Resolves to the configured `SessionStore`, if any.
 */

/**
 * Injection token resolving to the connected {@link import('./gram-client.interface').IGramClient}.
 * Override this token in tests to supply a fake client and avoid any network.
 */
export const TELEGRAM_GRAM_CLIENT = Symbol('NESTJS_TELEGRAM_GRAM_CLIENT');

/**
 * Injection token resolving to the configured
 * {@link import('./session/session-store.interface').SessionStore}, or
 * `undefined` when none was supplied.
 */
export const TELEGRAM_SESSION_STORE = Symbol('NESTJS_TELEGRAM_SESSION_STORE');
