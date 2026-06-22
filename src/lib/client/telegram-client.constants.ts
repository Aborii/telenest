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
 * - TELEGRAM_GRAM_CLIENT: Resolves to the default account's `IGramClient`.
 * - TELEGRAM_SESSION_STORE: Resolves to the default account's `SessionStore`, if any.
 * - DEFAULT_CLIENT_NAME: Sentinel name for the unnamed (default) account.
 */

/**
 * Injection token resolving to the connected {@link import('./gram-client.interface').IGramClient}.
 * Override this token in tests to supply a fake client and avoid any network.
 *
 * This token is bound to the **default** (unnamed) account. For a named account,
 * resolve its client via
 * {@link import('./telegram-client.tokens').getGramClientToken}.
 */
export const TELEGRAM_GRAM_CLIENT = Symbol('NESTJS_TELEGRAM_GRAM_CLIENT');

/**
 * Injection token resolving to the configured
 * {@link import('./session/session-store.interface').SessionStore}, or
 * `undefined` when none was supplied. Bound to the **default** account; for a
 * named account use
 * {@link import('./telegram-client.tokens').getSessionStoreToken}.
 */
export const TELEGRAM_SESSION_STORE = Symbol('NESTJS_TELEGRAM_SESSION_STORE');

/**
 * Sentinel name of the default account — the one registered by
 * `TelegramClientModule.forRoot()` / `forRootAsync()` when no `name` is supplied.
 *
 * It is the value `@OnUserMessage` records as its target account when given no
 * `client`, and the value the token helpers in `./telegram-client.tokens` treat
 * specially so the default account keeps its stable, legacy tokens
 * (`TELEGRAM_GRAM_CLIENT`, `TELEGRAM_SESSION_STORE`, and the `TelegramAuthService`
 * / `TelegramUserService` classes) for backward compatibility.
 */
export const DEFAULT_CLIENT_NAME = 'default';
