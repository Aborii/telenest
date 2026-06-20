/**
 * @file src/lib/client/telegram-user.service.ts
 *
 * PURPOSE
 * -------
 * High-level operations performed *as the logged-in user account* (not as a
 * bot): read the dialog list, fetch messages, and send messages on your own
 * behalf. All methods return library DTOs and require an authorized session
 * (establish one with {@link TelegramAuthService}).
 *
 * It also exposes {@link TelegramUserService.updates$}: a hot stream of inbound
 * messages received by the account (the same source `@OnUserMessage` handlers
 * subscribe to).
 *
 * USAGE
 * -----
 * ```ts
 * const me = await user.getMe();
 * await user.sendMessage('@durov', 'Hi from my own account!');
 * user.updates$.subscribe((m) => console.log('new message', m.text));
 * ```
 *
 * KEY EXPORTS
 * -----------
 * - TelegramUserService: Injectable user-account operations facade.
 */

import {
  Inject,
  Injectable,
  Logger,
  type OnModuleDestroy,
  type OnModuleInit,
} from '@nestjs/common';
import { Observable, Subject } from 'rxjs';
import type { IGramClient } from './gram-client.interface';
import type {
  GramDialog,
  GramGetDialogsParams,
  GramGetMessagesParams,
  GramMessage,
  GramPeer,
  GramSendMessageParams,
  GramUser,
} from './gram-client.types';
import { TELEGRAM_GRAM_CLIENT } from './telegram-client.constants';

/**
 * Facade for acting as the logged-in account over MTProto.
 *
 * Implements `OnModuleInit`/`OnModuleDestroy`: on init it subscribes to the
 * client's inbound-message events and fans them out through
 * {@link TelegramUserService.updates$}; on destroy it tears the subscription
 * down and completes the stream.
 */
@Injectable()
export class TelegramUserService implements OnModuleInit, OnModuleDestroy {
  /** Logger scoped to this service. */
  private readonly _logger = new Logger(TelegramUserService.name);

  /** Multicast source backing {@link updates$}. */
  private readonly _messages = new Subject<GramMessage>();

  /** Unsubscribe handle returned by `client.onNewMessage`. */
  private _unsubscribe?: () => void;

  /**
   * Hot, multicast stream of inbound messages received by the logged-in
   * account. Subscribers added later only see messages from that point on.
   */
  public readonly updates$: Observable<GramMessage> =
    this._messages.asObservable();

  /**
   * @param client - The MTProto client abstraction.
   */
  public constructor(
    @Inject(TELEGRAM_GRAM_CLIENT) private readonly client: IGramClient,
  ) {}

  /**
   * Begins fanning the client's new-message events into {@link updates$}.
   *
   * @returns Nothing.
   * @throws Never.
   */
  public onModuleInit(): void {
    this._unsubscribe = this.client.onNewMessage((message) =>
      this._messages.next(message),
    );
    this._logger.log('Subscribed to inbound account messages.');
  }

  /**
   * Stops forwarding events and completes the stream.
   *
   * @returns Nothing.
   * @throws Never.
   */
  public onModuleDestroy(): void {
    this._unsubscribe?.();
    this._unsubscribe = undefined;
    this._messages.complete();
  }

  /**
   * Returns the logged-in account's own profile.
   *
   * @returns The logged-in account's profile.
   * @throws {import('../common').TelegramClientError} If not authorized.
   */
  public async getMe(): Promise<GramUser> {
    await this.ensureConnected();
    return this.client.getMe();
  }

  /**
   * Lists the account's dialogs (conversations).
   *
   * @param params - Optional limit / archived filter.
   * @returns The dialog list.
   * @throws {import('../common').TelegramClientError} On failure.
   */
  public async getDialogs(
    params?: GramGetDialogsParams,
  ): Promise<GramDialog[]> {
    await this.ensureConnected();
    return this.client.getDialogs(params);
  }

  /**
   * Fetches recent messages from a peer.
   *
   * @param peer - Target peer (`'me'`, @username, or numeric id).
   * @param params - Optional limit / pagination bounds.
   * @returns The messages, newest first.
   * @throws {import('../common').TelegramClientError} On failure.
   */
  public async getMessages(
    peer: GramPeer,
    params?: GramGetMessagesParams,
  ): Promise<GramMessage[]> {
    await this.ensureConnected();
    return this.client.getMessages(peer, params);
  }

  /**
   * Sends a message as the logged-in account.
   *
   * @param peer - Target peer (`'me'`, @username, or numeric id).
   * @param text - Message text, or a full {@link GramSendMessageParams} object.
   * @returns The sent message.
   * @throws {import('../common').TelegramClientError} On failure.
   *
   * @example
   * ```ts
   * await user.sendMessage('me', 'Note to self');
   * await user.sendMessage('@channel', { message: '<b>Hi</b>', parseMode: 'html' });
   * ```
   */
  public async sendMessage(
    peer: GramPeer,
    text: string | GramSendMessageParams,
  ): Promise<GramMessage> {
    await this.ensureConnected();
    const params: GramSendMessageParams =
      typeof text === 'string' ? { message: text } : text;
    return this.client.sendMessage(peer, params);
  }

  /**
   * Convenience: sends a message to your own "Saved Messages" chat.
   *
   * @param text - The message text.
   * @returns The sent message.
   * @throws {import('../common').TelegramClientError} On failure.
   */
  public async sendToSelf(text: string): Promise<GramMessage> {
    return this.sendMessage('me', text);
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
}
