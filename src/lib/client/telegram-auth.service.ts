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
 * It also exposes the alternative sign-in flows — QR-code login
 * ({@link TelegramAuthService.signInWithQrCode}) and bot-token login
 * ({@link TelegramAuthService.signInAsBot}) — plus two-factor (2FA) password
 * management ({@link TelegramAuthService.setupTwoFactor} /
 * {@link TelegramAuthService.changeTwoFactor} /
 * {@link TelegramAuthService.disableTwoFactor}).
 *
 * On success the resulting string session is written to the configured
 * {@link SessionStore} so subsequent process starts skip the login entirely.
 *
 * USAGE
 * -----
 * ```ts
 * // Phone / code / 2FA
 * await auth.sendCode('+15551234567');
 * const step = await auth.signIn('12345');           // code from Telegram
 * if (step.status === 'password-required')
 *   await auth.checkPassword('my-2fa-password');
 *
 * // QR code
 * const { qr$, completed } = auth.signInWithQrCode();
 * qr$.subscribe((t) => renderQrCode(t.url));
 * const me = await completed;
 *
 * // Bot token
 * const bot = await auth.signInAsBot(process.env.BOT_TOKEN!);
 * ```
 *
 * KEY EXPORTS
 * -----------
 * - TelegramAuthService: Injectable login orchestrator.
 * - QrLoginHandle / QrLoginOptions: QR-login return type and options.
 * - SetupTwoFactorInput / ChangeTwoFactorInput: 2FA management inputs.
 */

import { Inject, Injectable, Logger, Optional } from '@nestjs/common';
import { Observable, Subject } from 'rxjs';

import { TelegramAuthError } from '../common';
import type { IGramClient } from './gram-client.interface';
import type {
  GramQrToken,
  GramSendCodeResult,
  GramSignInResult,
  GramUser,
} from './gram-client.types';
import type { SessionStore } from './session/session-store.interface';
import {
  TELEGRAM_GRAM_CLIENT,
  TELEGRAM_SESSION_STORE,
} from './telegram-client.constants';

/**
 * Live handle for an in-progress QR-code login returned by
 * {@link TelegramAuthService.signInWithQrCode}.
 *
 * The QR token rotates (~every 30s) until it is scanned, so the tokens are
 * delivered as a *stream* rather than a single value: subscribe to {@link qr$}
 * and always render the latest emission. The terminal outcome is the
 * {@link completed} promise.
 */
export interface QrLoginHandle {
  /**
   * Hot stream of QR tokens — emits the first token shortly after subscription
   * and again on each rotation. Completes when the login settles (either
   * outcome). Render the most recent token's `url` as a QR code.
   */
  qr$: Observable<GramQrToken>;
  /**
   * Resolves with the authenticated account once the QR code is scanned (and,
   * for a 2FA account, once the password is supplied), after persisting the
   * session. Rejects with a {@link TelegramAuthError} on failure. Always attach
   * a handler — an unhandled rejection will surface as a Node warning.
   */
  completed: Promise<GramUser>;
}

/** Options for {@link TelegramAuthService.signInWithQrCode}. */
export interface QrLoginOptions {
  /**
   * Resolves the account's 2FA password when the scanned account has
   * two-step verification enabled (the `hint`, if any, is Telegram's stored
   * hint). Omit for accounts without 2FA — if 2FA is then encountered, the
   * login rejects with a `PASSWORD_REQUIRED` {@link TelegramAuthError}.
   */
  onPassword?: (hint?: string) => Promise<string>;
}

/** Input for {@link TelegramAuthService.setupTwoFactor}. */
export interface SetupTwoFactorInput {
  /** The 2FA password to enable on the account. */
  password: string;
  /** Optional hint Telegram shows at the password prompt. */
  hint?: string;
}

/** Input for {@link TelegramAuthService.changeTwoFactor}. */
export interface ChangeTwoFactorInput {
  /** The account's current 2FA password (required to authorize the change). */
  currentPassword: string;
  /** The new 2FA password to set. */
  newPassword: string;
  /** Optional hint Telegram shows at the password prompt. */
  hint?: string;
}

/**
 * Orchestrates the phone/code/2FA sign-in flow and persists the session.
 *
 * State (the pending phone number and code hash) is held on the instance, which
 * is correct because each registered account gets its own instance (the default
 * account, or one per `forRoot({ name })`). Do not share a single instance across
 * concurrent logins for different numbers.
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
   * Begins a QR-code login. Subscribe to the returned handle's `qr$` to render
   * each QR token and await its `completed` promise for the authenticated
   * account; the session is persisted on success.
   *
   * @param options - Optional `onPassword` callback for 2FA-protected accounts.
   * @returns A {@link QrLoginHandle} (`qr$` stream + `completed` promise).
   * @throws Never synchronously — failures reject the `completed` promise with a
   *   {@link TelegramAuthError}.
   *
   * @example
   * ```ts
   * const { qr$, completed } = auth.signInWithQrCode();
   * qr$.subscribe((t) => renderQrCode(t.url)); // e.g. print a QR to the terminal
   * const me = await completed;                // resolves once scanned
   * ```
   */
  public signInWithQrCode(options: QrLoginOptions = {}): QrLoginHandle {
    const tokens = new Subject<GramQrToken>();
    return {
      qr$: tokens.asObservable(),
      completed: this.runQrLogin(tokens, options.onPassword),
    };
  }

  /**
   * Signs in as a bot using a BotFather token over the MTProto transport, then
   * persists the session.
   *
   * @param botToken - The bot token from BotFather (`<id>:<secret>`).
   * @returns The authenticated bot account.
   * @throws {TelegramAuthError} If the token is rejected.
   *
   * @example
   * ```ts
   * const bot = await auth.signInAsBot(process.env.BOT_TOKEN!);
   * ```
   */
  public async signInAsBot(botToken: string): Promise<GramUser> {
    await this.ensureConnected();
    const user = await this.client.signInAsBot(botToken);
    this._logger.log('Signed in successfully as a bot.');
    await this.persistSession();
    return user;
  }

  /**
   * Enables two-factor (2FA) verification on an account that does not yet have
   * it. Requires an already-authorized session.
   *
   * @param input - The new `password` and an optional `hint`.
   * @returns Resolves once 2FA is enabled.
   * @throws {TelegramAuthError} If the update fails.
   *
   * @example
   * ```ts
   * await auth.setupTwoFactor({ password: 'hunter2', hint: 'usual' });
   * ```
   */
  public async setupTwoFactor(input: SetupTwoFactorInput): Promise<void> {
    await this.ensureConnected();
    await this.client.updateTwoFactor({
      newPassword: input.password,
      hint: input.hint,
    });
    this._logger.log('Two-factor authentication enabled.');
  }

  /**
   * Changes the account's existing two-factor (2FA) password.
   *
   * @param input - The `currentPassword`, the `newPassword`, and optional `hint`.
   * @returns Resolves once the password is changed.
   * @throws {TelegramAuthError} With `PASSWORD_INVALID` when `currentPassword`
   *   is wrong, or another code on failure.
   *
   * @example
   * ```ts
   * await auth.changeTwoFactor({ currentPassword: 'old', newPassword: 'new' });
   * ```
   */
  public async changeTwoFactor(input: ChangeTwoFactorInput): Promise<void> {
    await this.ensureConnected();
    await this.client.updateTwoFactor({
      currentPassword: input.currentPassword,
      newPassword: input.newPassword,
      hint: input.hint,
    });
    this._logger.log('Two-factor password changed.');
  }

  /**
   * Removes two-factor (2FA) verification from the account.
   *
   * @param currentPassword - The account's current 2FA password.
   * @returns Resolves once 2FA is removed.
   * @throws {TelegramAuthError} With `PASSWORD_INVALID` when the password is
   *   wrong, or another code on failure.
   *
   * @example
   * ```ts
   * await auth.disableTwoFactor('hunter2');
   * ```
   */
  public async disableTwoFactor(currentPassword: string): Promise<void> {
    await this.ensureConnected();
    // ── Omitting `newPassword` tells the client to clear the password. ───────
    await this.client.updateTwoFactor({ currentPassword });
    this._logger.log('Two-factor authentication removed.');
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
   * Drives a QR login to completion, feeding each issued token into `tokens`
   * and completing that stream once the login settles (either outcome).
   *
   * @param tokens - The subject backing the handle's `qr$` stream.
   * @param onPassword - Optional 2FA password resolver.
   * @returns The authenticated account once the QR code is scanned.
   * @throws {TelegramAuthError} If the login fails (propagated to `completed`).
   */
  private async runQrLogin(
    tokens: Subject<GramQrToken>,
    onPassword?: (hint?: string) => Promise<string>,
  ): Promise<GramUser> {
    try {
      await this.ensureConnected();
      const user = await this.client.signInWithQrCode({
        onToken: (token) => tokens.next(token),
        onPassword,
      });
      this._logger.log('Signed in successfully via QR code.');
      await this.persistSession();
      return user;
    } finally {
      // ── Always close the token stream; the outcome rides the returned
      //    promise, so we never push the error through `qr$`. ────────────────
      tokens.complete();
    }
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
