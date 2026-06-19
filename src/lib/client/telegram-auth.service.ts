/**
 * @file src/lib/client/telegram-auth.service.ts
 *
 * PURPOSE
 * -------
 * Drives the user-account (MTProto) login state machine for a *single* account:
 *
 *   sendCode(phone) ─▶ signIn(code) ─┬─▶ authorized
 *                                    └─▶ password-required ─▶ checkPassword(pw) ─▶ authorized
 *
 * On success the resulting string session is written to the configured
 * {@link SessionStore} so subsequent process starts skip the login entirely.
 *
 * USAGE
 * -----
 * ```ts
 * await auth.sendCode('+15551234567');
 * const step = await auth.signIn('12345');           // code from Telegram
 * if (step.status === 'password-required')
 *   await auth.checkPassword('my-2fa-password');
 * ```
 *
 * KEY EXPORTS
 * -----------
 * - TelegramAuthService: Injectable login orchestrator.
 */

import { Inject, Injectable, Logger, Optional } from '@nestjs/common';
import { TelegramAuthError } from '../common';
import type { IGramClient } from './gram-client.interface';
import type {
  GramSendCodeResult,
  GramSignInResult,
  GramUser,
} from './gram-client.types';
import {
  TELEGRAM_GRAM_CLIENT,
  TELEGRAM_SESSION_STORE,
} from './telegram-client.constants';
import type { SessionStore } from './session/session-store.interface';

/**
 * Orchestrates the phone/code/2FA sign-in flow and persists the session.
 *
 * State (the pending phone number and code hash) is held on the instance, which
 * is correct because the module manages exactly one account. Do not share a
 * single instance across concurrent logins for different numbers.
 */
@Injectable()
export class TelegramAuthService {
  /** Logger scoped to this service. */
  private readonly _logger = new Logger(TelegramAuthService.name);

  /** Phone number passed to the most recent {@link sendCode} call. */
  private _phoneNumber?: string;

  /** `phoneCodeHash` returned by the most recent {@link sendCode} call. */
  private _phoneCodeHash?: string;

  /**
   * @param client - The MTProto client abstraction.
   * @param sessionStore - Optional session persistence backend.
   */
  public constructor(
    @Inject(TELEGRAM_GRAM_CLIENT) private readonly client: IGramClient,
    @Optional()
    @Inject(TELEGRAM_SESSION_STORE)
    private readonly sessionStore?: SessionStore,
  ) {}

  /**
   * Requests a login code for the given phone number.
   *
   * @param phoneNumber - Phone number in international format (e.g. `+15551234`).
   * @param forceSMS - Force SMS delivery instead of the in-app code.
   * @returns The send-code result (used internally to complete sign-in).
   * @throws {TelegramAuthError} If the phone number is rejected.
   *
   * @example
   * ```ts
   * await auth.sendCode('+15551234567');
   * ```
   */
  public async sendCode(
    phoneNumber: string,
    forceSMS = false,
  ): Promise<GramSendCodeResult> {
    await this.ensureConnected();
    const result = await this.client.sendCode(phoneNumber, forceSMS);
    this._phoneNumber = phoneNumber;
    this._phoneCodeHash = result.phoneCodeHash;
    this._logger.log(`Login code sent to ${this.maskPhone(phoneNumber)}.`);
    return result;
  }

  /**
   * Completes sign-in with the code the user received.
   *
   * @param phoneCode - The login code from Telegram.
   * @returns `authorized` (session persisted) or `password-required` (2FA on).
   * @throws {TelegramAuthError} With code `CODE_NOT_REQUESTED` when called
   *   before {@link sendCode}, or `CODE_INVALID` when the code is wrong.
   *
   * @example
   * ```ts
   * const step = await auth.signIn('12345');
   * ```
   */
  public async signIn(phoneCode: string): Promise<GramSignInResult> {
    if (!this._phoneNumber || !this._phoneCodeHash)
      throw new TelegramAuthError(
        'CODE_NOT_REQUESTED',
        'Call sendCode() before signIn().',
      );

    await this.ensureConnected();
    const result = await this.client.signInWithCode({
      phoneNumber: this._phoneNumber,
      phoneCodeHash: this._phoneCodeHash,
      phoneCode,
    });

    if (result.status === 'authorized') {
      this._logger.log('Signed in successfully (no 2FA).');
      await this.persistSession();
    } else {
      this._logger.log('Code accepted; 2FA password required.');
    }

    return result;
  }

  /**
   * Completes a 2FA-protected sign-in with the account password.
   *
   * @param password - The two-step-verification password.
   * @returns The authenticated account.
   * @throws {TelegramAuthError} With code `PASSWORD_INVALID` when wrong.
   *
   * @example
   * ```ts
   * const me = await auth.checkPassword('my-2fa-password');
   * ```
   */
  public async checkPassword(password: string): Promise<GramUser> {
    await this.ensureConnected();
    const user = await this.client.signInWithPassword(password);
    this._logger.log('Signed in successfully (2FA).');
    await this.persistSession();
    return user;
  }

  /**
   * Logs out, invalidating the session locally and on Telegram's servers.
   *
   * @returns Resolves once logged out and the stored session is cleared.
   * @throws {import('../common').TelegramClientError} On transport failure.
   */
  public async logOut(): Promise<void> {
    await this.client.logOut();
    this._phoneNumber = undefined;
    this._phoneCodeHash = undefined;
    if (this.sessionStore) await this.sessionStore.clear();
    this._logger.log('Logged out and cleared stored session.');
  }

  /**
   * @returns Whether the current session is authorized.
   * @throws {import('../common').TelegramClientError} On transport failure.
   */
  public async isAuthorized(): Promise<boolean> {
    await this.ensureConnected();
    return this.client.isAuthorized();
  }

  /**
   * Serializes the current session for manual persistence/inspection.
   *
   * @returns The string session (empty when unauthenticated).
   * @throws Never.
   */
  public exportSession(): string {
    return this.client.exportSession();
  }

  /**
   * Ensures the underlying client is connected before an operation.
   *
   * @returns Resolves once a connection is open.
   * @throws {import('../common').TelegramClientError} If connecting fails.
   */
  private async ensureConnected(): Promise<void> {
    if (!this.client.isConnected()) await this.client.connect();
  }

  /**
   * Persists the current session to the configured store, if any.
   *
   * @returns Resolves once persisted (no-op without a store).
   * @throws {import('../common').TelegramSessionError} On a write failure.
   */
  private async persistSession(): Promise<void> {
    if (!this.sessionStore) return;
    const session = this.client.exportSession();
    await this.sessionStore.save(session);
    this._logger.log('Session persisted to the configured store.');
  }

  /**
   * Masks a phone number for safe logging by keeping only the first two and
   * last two characters and replacing the middle with asterisks. Inputs of
   * four characters or fewer are masked entirely.
   *
   * @param phone - The raw phone number.
   * @returns A masked variant such as `+1******67`.
   * @throws Never.
   */
  private maskPhone(phone: string): string {
    if (phone.length <= 4) return '*'.repeat(phone.length);
    const head = phone.slice(0, 2);
    const tail = phone.slice(-2);
    return `${head}${'*'.repeat(Math.max(0, phone.length - 4))}${tail}`;
  }
}
