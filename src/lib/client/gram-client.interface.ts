/**
 * @file src/lib/client/gram-client.interface.ts
 *
 * PURPOSE
 * -------
 * The abstraction boundary between this library's MTProto services and GramJS.
 * Services depend only on {@link IGramClient}; the concrete GramJS adapter is
 * the single implementation that touches the `telegram` package. This makes
 * every service unit-testable with a trivial in-memory fake and keeps GramJS
 * out of consumer compilation units.
 *
 * USAGE
 * -----
 * ```ts
 * const fake: IGramClient = { getMe: async () => me, ... };
 * const service = new TelegramUserService(fake);
 * ```
 *
 * KEY EXPORTS
 * -----------
 * - IGramClient: Minimal, fully-typed client surface used by the services.
 */

import type {
  GramDialog,
  GramGetDialogsParams,
  GramGetMessagesParams,
  GramMessage,
  GramPeer,
  GramSendCodeResult,
  GramSendMessageParams,
  GramSignInResult,
  GramSignInWithCodeInput,
  GramUser,
} from './gram-client.types';

/**
 * Minimal MTProto client surface consumed by {@link import('./telegram-auth.service').TelegramAuthService}
 * and {@link import('./telegram-user.service').TelegramUserService}. Every method
 * returns library DTOs (never raw GramJS `Api.*` objects), so the public API is
 * stable across GramJS upgrades.
 */
export interface IGramClient {
  /**
   * Opens the MTProto connection. Idempotent.
   *
   * @returns Resolves once connected.
   * @throws {import('../common').TelegramClientError} On transport failure.
   */
  connect(): Promise<void>;

  /**
   * Closes the MTProto connection. Idempotent.
   *
   * @returns Resolves once disconnected.
   * @throws Never (disconnect errors are swallowed).
   */
  disconnect(): Promise<void>;

  /**
   * @returns Whether the client currently holds an open connection.
   * @throws Never.
   */
  isConnected(): boolean;

  /**
   * @returns Whether the current session is authorized (logged in).
   * @throws {import('../common').TelegramClientError} On transport failure.
   */
  isAuthorized(): Promise<boolean>;

  /**
   * Requests a login code be sent to the given phone number.
   *
   * @param phoneNumber - Phone number in international format (e.g. `+15551234`).
   * @param forceSMS - Force SMS delivery instead of the in-app code.
   * @returns The `phoneCodeHash` needed to complete sign-in.
   * @throws {import('../common').TelegramAuthError} If the phone is rejected.
   */
  sendCode(phoneNumber: string, forceSMS?: boolean): Promise<GramSendCodeResult>;

  /**
   * Completes sign-in with the code the user received.
   *
   * @param input - Phone number, `phoneCodeHash`, and the received code.
   * @returns `authorized` with the user, or `password-required` when 2FA is on.
   * @throws {import('../common').TelegramAuthError} If the code is invalid.
   */
  signInWithCode(input: GramSignInWithCodeInput): Promise<GramSignInResult>;

  /**
   * Completes a 2FA-protected sign-in with the account password.
   *
   * @param password - The account's two-step-verification password.
   * @returns The authenticated account.
   * @throws {import('../common').TelegramAuthError} If the password is wrong.
   */
  signInWithPassword(password: string): Promise<GramUser>;

  /**
   * Logs out, invalidating the current session on Telegram's servers.
   *
   * @returns Resolves once logged out.
   * @throws {import('../common').TelegramClientError} On transport failure.
   */
  logOut(): Promise<void>;

  /**
   * @returns The logged-in account's profile.
   * @throws {import('../common').TelegramClientError} If not authorized.
   */
  getMe(): Promise<GramUser>;

  /**
   * Lists the account's dialogs (conversations).
   *
   * @param params - Optional limit / archived filter.
   * @returns The dialog list.
   * @throws {import('../common').TelegramClientError} On failure.
   */
  getDialogs(params?: GramGetDialogsParams): Promise<GramDialog[]>;

  /**
   * Fetches recent messages from a peer.
   *
   * @param peer - Target peer (`'me'`, @username, or numeric id).
   * @param params - Optional limit / pagination bounds.
   * @returns The messages, newest first.
   * @throws {import('../common').TelegramClientError} On failure.
   */
  getMessages(
    peer: GramPeer,
    params?: GramGetMessagesParams,
  ): Promise<GramMessage[]>;

  /**
   * Sends a message as the logged-in account.
   *
   * @param peer - Target peer (`'me'`, @username, or numeric id).
   * @param params - Message text and options.
   * @returns The sent message.
   * @throws {import('../common').TelegramClientError} On failure.
   */
  sendMessage(
    peer: GramPeer,
    params: GramSendMessageParams,
  ): Promise<GramMessage>;

  /**
   * Serializes the current session to a portable string for persistence.
   *
   * @returns The string session (empty string when unauthenticated).
   * @throws Never.
   */
  exportSession(): string;
}
