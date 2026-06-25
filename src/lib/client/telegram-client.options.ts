/**
 * @file src/lib/client/telegram-client.options.ts
 *
 * PURPOSE
 * -------
 * Public configuration contract for `TelegramClientModule` (the MTProto / user
 * account side). Obtain `apiId` and `apiHash` from https://my.telegram.org →
 * "API development tools". These authenticate the *application*, while the
 * phone/code/2FA flow authenticates the *account*.
 *
 * USAGE
 * -----
 * ```ts
 * TelegramClientModule.forRoot({
 *   apiId: Number(process.env.TG_API_ID),
 *   apiHash: process.env.TG_API_HASH!,
 *   sessionStore: new FileSessionStore('./.telegram.session'),
 * });
 * ```
 *
 * KEY EXPORTS
 * -----------
 * - TelegramClientModuleOptions: Synchronous configuration object.
 * - GramClientFactory: Seam for injecting a custom/fake client (tests).
 */

import type { IGramClient } from './gram-client.interface';
import type { SessionStore } from './session/session-store.interface';

/**
 * Factory that produces an {@link IGramClient}. Supply one via
 * {@link TelegramClientModuleOptions.clientFactory} to replace the real GramJS
 * client — primarily for unit/e2e tests that must never hit the network.
 *
 * @param options - The validated module options.
 * @param session - The initial string session (possibly empty).
 * @returns A (not necessarily connected) client implementation.
 */
export type GramClientFactory = (
  options: TelegramClientModuleOptions,
  session: string,
) => IGramClient;

/**
 * Synchronous configuration for `TelegramClientModule`.
 */
export interface TelegramClientModuleOptions {
  /** Application `api_id` from my.telegram.org. */
  apiId: number;

  /** Application `api_hash` from my.telegram.org. */
  apiHash: string;

  /**
   * An existing string session to start from. Takes precedence over a value
   * loaded from {@link TelegramClientModuleOptions.sessionStore}.
   */
  session?: string;

  /**
   * Pluggable session persistence. When provided, the module loads the initial
   * session from it (if `session` is not set) and the auth service writes the
   * session back to it after a successful login.
   */
  sessionStore?: SessionStore;

  /**
   * Number of automatic reconnection attempts on transport errors.
   * Defaults to GramJS' own default.
   */
  connectionRetries?: number;

  /** Reported device model (shows up in the account's active-sessions list). */
  deviceModel?: string;

  /** Reported system version. */
  systemVersion?: string;

  /** Reported application version. */
  appVersion?: string;

  /** Use WebSocket transport (required in browsers). Defaults to `false`. */
  useWSS?: boolean;

  /**
   * Auto-sleep threshold (seconds) for `FLOOD_WAIT` errors below which GramJS
   * waits and retries transparently instead of throwing.
   */
  floodSleepThreshold?: number;

  /**
   * Whether to connect on module initialization. Defaults to `true`. Set to
   * `false` to connect lazily/manually (e.g. in tests or CLI login scripts).
   */
  autoConnect?: boolean;

  /**
   * Catch-up buffer depth for the inbound update streams
   * ({@link import('./telegram-user.service').TelegramUserService.updates$} and
   * its edited/deleted/chat-action siblings). When greater than zero, each
   * stream replays up to this many of its most recent events to a subscriber
   * added *after* bootstrap, so a late `@OnUserMessage` (or manual `subscribe`)
   * still sees the recent backlog. Defaults to `0` — hot streams with no replay.
   */
  replayBufferSize?: number;

  /**
   * Override the client construction. Primarily a test seam; when omitted the
   * module builds a real GramJS-backed client.
   */
  clientFactory?: GramClientFactory;
}
