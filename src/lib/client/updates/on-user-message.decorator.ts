/**
 * @file src/lib/client/updates/on-user-message.decorator.ts
 *
 * PURPOSE
 * -------
 * The `@OnUserMessage` method decorator. It tags a provider method so the
 * {@link import('./telegram-user-updates.registrar').TelegramUserUpdatesRegistrar}
 * subscribes it to the inbound message stream (filtered) at bootstrap.
 *
 * USAGE
 * -----
 * ```ts
 * @Injectable()
 * class AutoReply {
 *   @OnUserMessage({ incoming: true, pattern: /^ping$/i })
 *   async onPing(message: GramMessage, ctx: GramUserMessageContext) {
 *     await ctx.reply('pong');
 *   }
 * }
 * ```
 *
 * KEY EXPORTS
 * -----------
 * - ON_USER_MESSAGE_METADATA: Metadata key the registrar reads.
 * - OnUserMessage: The method decorator.
 */

import { SetMetadata } from '@nestjs/common';
import type { OnUserMessageFilter } from './on-user-message.types';

/** Metadata key under which a handler's {@link OnUserMessageFilter} is stored. */
export const ON_USER_MESSAGE_METADATA = 'nestjs-telegram:on-user-message';

/**
 * Marks a provider method as a handler for inbound user-account messages.
 *
 * @param filter - Optional match criteria; omit to receive every message.
 * @returns A method decorator that attaches the filter metadata.
 * @throws Never.
 *
 * @example
 * ```ts
 * @OnUserMessage({ chatId: '@mychannel' })
 * onChannelPost(message: GramMessage) { ... }
 * ```
 */
export function OnUserMessage(
  filter: OnUserMessageFilter = {},
): MethodDecorator {
  return SetMetadata(ON_USER_MESSAGE_METADATA, filter);
}
