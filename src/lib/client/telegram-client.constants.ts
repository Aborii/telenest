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
 * - TELEGRAM_CLIENT_METRICS: Resolves to the default account's metrics surface.
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
 * Injection token resolving to the **default** account's
 * {@link import('../common').TelegramMetrics} surface (an
 * {@link import('../common').InMemoryTelegramMetrics} by default). Inject it to
 * read the account's traffic counters (`messagesSent`, `messagesReceived`) via
 * `.snapshot()`, or override the provider to bridge to your own backend. For a
 * named account, resolve its metrics via
 * {@link import('./telegram-client.tokens').getClientMetricsToken}.
 */
export const TELEGRAM_CLIENT_METRICS = Symbol('NESTJS_TELEGRAM_CLIENT_METRICS');

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
