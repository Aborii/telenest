/**
 * @file src/lib/client/telegram-client.tokens.ts
 *
 * PURPOSE
 * -------
 * Per-account dependency-injection token helpers that make multiple named user
 * accounts possible in one application. Each registered account owns its own
 * providers — the raw {@link IGramClient}, its {@link SessionStore}, the
 * {@link TelegramAuthService} and {@link TelegramUserService}, plus an internal
 * lifecycle disposer and update registrar — and these helpers compute the stable
 * DI token for each, given the account's name.
 *
 * The **default** (unnamed) account keeps its original, legacy tokens for full
 * backward compatibility: the `TELEGRAM_GRAM_CLIENT` / `TELEGRAM_SESSION_STORE`
 * symbols and the `TelegramAuthService` / `TelegramUserService` classes. Named
 * accounts get distinct string tokens derived from the name, so two registrations
 * never collide.
 *
 * USAGE
 * -----
 * ```ts
 * // Inject a named account's services:
 * constructor(
 *   @InjectTelegramUser('personal') private readonly personal: TelegramUserService,
 *   @InjectTelegramAuth('personal') private readonly personalAuth: TelegramAuthService,
 * ) {}
 *
 * // Grab a named account's raw client:
 * constructor(@Inject(getGramClientToken('personal')) private readonly raw: IGramClient) {}
 * ```
 *
 * KEY EXPORTS
 * -----------
 * - getGramClientToken: DI token for an account's raw `IGramClient`.
 * - getSessionStoreToken: DI token for an account's `SessionStore`.
 * - getTelegramAuthToken / getTelegramUserToken: tokens for the two services.
 * - getClientLifecycleToken / getClientRegistrarToken: internal per-account tokens.
 * - getClientMetricsToken: DI token for an account's metrics surface.
 * - getClientHealthToken: DI token for an account's health indicator.
 * - InjectTelegramUser / InjectTelegramAuth: inject a named account's service.
 */

import { Inject, type InjectionToken } from '@nestjs/common';

import { TelegramAuthService } from './telegram-auth.service';
import {
  DEFAULT_CLIENT_NAME,
  TELEGRAM_CLIENT_METRICS,
  TELEGRAM_GRAM_CLIENT,
  TELEGRAM_SESSION_STORE,
} from './telegram-client.constants';
import { TelegramClientHealthIndicator } from './telegram-client.health';
import { TelegramClientLifecycle } from './telegram-client.lifecycle';
import { TelegramUserService } from './telegram-user.service';
import { TelegramUserUpdatesRegistrar } from './updates/telegram-user-updates.registrar';

/** Token prefix for a named account's raw `IGramClient`. */
const NAMED_GRAM_CLIENT_PREFIX = 'NESTJS_TELEGRAM_GRAM_CLIENT:';

/** Token prefix for a named account's `SessionStore`. */
const NAMED_SESSION_STORE_PREFIX = 'NESTJS_TELEGRAM_SESSION_STORE:';

/** Token prefix for a named account's `TelegramAuthService`. */
const NAMED_AUTH_SERVICE_PREFIX = 'NESTJS_TELEGRAM_AUTH_SERVICE:';

/** Token prefix for a named account's `TelegramUserService`. */
const NAMED_USER_SERVICE_PREFIX = 'NESTJS_TELEGRAM_USER_SERVICE:';

/** Token prefix for a named account's lifecycle disposer. */
const NAMED_LIFECYCLE_PREFIX = 'NESTJS_TELEGRAM_CLIENT_LIFECYCLE:';

/** Token prefix for a named account's update registrar. */
const NAMED_REGISTRAR_PREFIX = 'NESTJS_TELEGRAM_USER_REGISTRAR:';

/** Token prefix for a named account's metrics surface. */
const NAMED_METRICS_PREFIX = 'NESTJS_TELEGRAM_CLIENT_METRICS:';

/** Token prefix for a named account's health indicator. */
const NAMED_HEALTH_PREFIX = 'NESTJS_TELEGRAM_CLIENT_HEALTH:';

/**
 * Whether `name` refers to the default account (unset, or the default sentinel).
 *
 * @param name - The account name to test.
 * @returns `true` for the default account; `false` for a named account.
 * @throws Never.
 */
function isDefaultClient(name?: string): boolean {
  return !name || name === DEFAULT_CLIENT_NAME;
}

/**
 * Resolves the DI token for an account's raw `IGramClient` — the low-level seam
 * beneath the {@link TelegramUserService} / {@link TelegramAuthService} facades.
 *
 * @param name - The account name; omit (or pass the default name) for the default.
 * @returns The `TELEGRAM_GRAM_CLIENT` symbol for the default account, else a
 *   name-derived string token.
 * @throws Never.
 */
export function getGramClientToken(name?: string): InjectionToken {
  return isDefaultClient(name)
    ? TELEGRAM_GRAM_CLIENT
    : `${NAMED_GRAM_CLIENT_PREFIX}${name}`;
}

/**
 * Resolves the DI token for an account's {@link SessionStore}.
 *
 * @param name - The account name; omit (or pass the default name) for the default.
 * @returns The `TELEGRAM_SESSION_STORE` symbol for the default account, else a
 *   name-derived string token.
 * @throws Never.
 */
export function getSessionStoreToken(name?: string): InjectionToken {
  return isDefaultClient(name)
    ? TELEGRAM_SESSION_STORE
    : `${NAMED_SESSION_STORE_PREFIX}${name}`;
}

/**
 * Resolves the DI token for an account's {@link TelegramAuthService}.
 *
 * @param name - The account name; omit (or pass the default name) for the default.
 * @returns The `TelegramAuthService` class for the default account, else a
 *   name-derived string token.
 * @throws Never.
 */
export function getTelegramAuthToken(name?: string): InjectionToken {
  return isDefaultClient(name)
    ? TelegramAuthService
    : `${NAMED_AUTH_SERVICE_PREFIX}${name}`;
}

/**
 * Resolves the DI token for an account's {@link TelegramUserService}.
 *
 * @param name - The account name; omit (or pass the default name) for the default.
 * @returns The `TelegramUserService` class for the default account, else a
 *   name-derived string token.
 * @throws Never.
 */
export function getTelegramUserToken(name?: string): InjectionToken {
  return isDefaultClient(name)
    ? TelegramUserService
    : `${NAMED_USER_SERVICE_PREFIX}${name}`;
}

/**
 * Resolves the DI token for an account's lifecycle disposer. Internal wiring —
 * consumers never inject it directly.
 *
 * @param name - The account name; omit (or pass the default name) for the default.
 * @returns The `TelegramClientLifecycle` class for the default account, else a
 *   name-derived string token.
 * @throws Never.
 */
export function getClientLifecycleToken(name?: string): InjectionToken {
  return isDefaultClient(name)
    ? TelegramClientLifecycle
    : `${NAMED_LIFECYCLE_PREFIX}${name}`;
}

/**
 * Resolves the DI token for an account's update registrar. Internal wiring —
 * consumers never inject it directly.
 *
 * @param name - The account name; omit (or pass the default name) for the default.
 * @returns The `TelegramUserUpdatesRegistrar` class for the default account, else
 *   a name-derived string token.
 * @throws Never.
 */
export function getClientRegistrarToken(name?: string): InjectionToken {
  return isDefaultClient(name)
    ? TelegramUserUpdatesRegistrar
    : `${NAMED_REGISTRAR_PREFIX}${name}`;
}

/**
 * Resolves the DI token for an account's
 * {@link import('../common').TelegramMetrics} surface — inject it to read the
 * account's traffic counters via `.snapshot()`.
 *
 * @param name - The account name; omit (or pass the default name) for the default.
 * @returns The `TELEGRAM_CLIENT_METRICS` symbol for the default account, else a
 *   name-derived string token.
 * @throws Never.
 */
export function getClientMetricsToken(name?: string): InjectionToken {
  return isDefaultClient(name)
    ? TELEGRAM_CLIENT_METRICS
    : `${NAMED_METRICS_PREFIX}${name}`;
}

/**
 * Resolves the DI token for an account's
 * {@link import('./telegram-client.health').TelegramClientHealthIndicator}.
 *
 * @param name - The account name; omit (or pass the default name) for the default.
 * @returns The `TelegramClientHealthIndicator` class for the default account,
 *   else a name-derived string token.
 * @throws Never.
 */
export function getClientHealthToken(name?: string): InjectionToken {
  return isDefaultClient(name)
    ? TelegramClientHealthIndicator
    : `${NAMED_HEALTH_PREFIX}${name}`;
}

/**
 * Parameter/property decorator that injects a named account's
 * {@link TelegramUserService} (the "act as the account" facade).
 *
 * @param name - The account name; omit (or pass the default name) for the default.
 * @returns A decorator equivalent to `@Inject(getTelegramUserToken(name))`.
 * @throws Never.
 *
 * @example
 * ```ts
 * constructor(@InjectTelegramUser('personal') private readonly user: TelegramUserService) {}
 * ```
 */
export const InjectTelegramUser = (
  name?: string,
): PropertyDecorator & ParameterDecorator => Inject(getTelegramUserToken(name));

/**
 * Parameter/property decorator that injects a named account's
 * {@link TelegramAuthService} (the login orchestrator).
 *
 * @param name - The account name; omit (or pass the default name) for the default.
 * @returns A decorator equivalent to `@Inject(getTelegramAuthToken(name))`.
 * @throws Never.
 *
 * @example
 * ```ts
 * constructor(@InjectTelegramAuth('personal') private readonly auth: TelegramAuthService) {}
 * ```
 */
export const InjectTelegramAuth = (
  name?: string,
): PropertyDecorator & ParameterDecorator => Inject(getTelegramAuthToken(name));
