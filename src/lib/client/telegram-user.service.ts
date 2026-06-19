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
 * USAGE
 * -----
 * ```ts
 * const me = await user.getMe();
 * await user.sendMessage('@durov', 'Hi from my own account!');
 * ```
 *
 * KEY EXPORTS
 * -----------
 * - TelegramUserService: Injectable user-account operations facade.
 */

import { Inject, Injectable } from '@nestjs/common';
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
 */
@Injectable()
export class TelegramUserService {
  /**
   * @param client - The MTProto client abstraction.
   */
  public constructor(
    @Inject(TELEGRAM_GRAM_CLIENT) private readonly client: IGramClient,
  ) {}

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
