/**
 * @file src/lib/client/updates/on-user-message.types.ts
 *
 * PURPOSE
 * -------
 * Public types for the inbound user-account update system: the filter accepted
 * by {@link import('./on-user-message.decorator').OnUserMessage} and the context
 * object handed to each handler.
 *
 * USAGE
 * -----
 * ```ts
 * @OnUserMessage({ incoming: true, pattern: /^ping$/i })
 * async onPing(message: GramMessage, ctx: GramUserMessageContext) {
 *   await ctx.reply('pong');
 * }
 * ```
 *
 * KEY EXPORTS
 * -----------
 * - OnUserMessageFilter: Declarative match criteria for a handler.
 * - GramUserMessageContext: Per-message context (message + reply helper).
 */

import type {
  GramMessage,
  GramPeer,
  GramSendMessageParams,
} from '../gram-client.types';

/**
 * Declarative criteria deciding whether an incoming message is dispatched to a
 * decorated handler. All present fields must match (logical AND); omitting a
 * field means "don't care".
 */
export interface OnUserMessageFilter {
  /** Only messages received *from others* (i.e. not sent by the logged-in account). */
  incoming?: boolean;
  /** Only messages *sent by the logged-in account*. */
  outgoing?: boolean;
  /**
   * Match the message text. A `RegExp` is tested against the text; a `string`
   * must equal the text exactly.
   */
  pattern?: RegExp | string;
  /** Restrict to one or more chat/peer ids (matched against `message.peerId`). */
  chatId?: GramPeer | readonly GramPeer[];
}

/**
 * Context passed as the second argument to every `@OnUserMessage` handler.
 */
export interface GramUserMessageContext {
  /** The message that triggered the handler. */
  message: GramMessage;
  /**
   * Replies in the same chat the message came from.
   *
   * @param text - Plain text, or full send parameters.
   * @returns The sent message.
   * @throws {import('../../common').TelegramClientError} On failure.
   */
  reply(text: string | GramSendMessageParams): Promise<GramMessage>;
}

/** Shape of a method decorated with `@OnUserMessage`. */
export type OnUserMessageHandler = (
  message: GramMessage,
  context: GramUserMessageContext,
) => unknown | Promise<unknown>;
