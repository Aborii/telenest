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
 *
 *   // Scope to a specific named account (multi-account apps):
 *   @OnUserMessage({ incoming: true }, { client: 'ops' })
 *   async onOps(message: GramMessage, ctx: GramUserMessageContext) {
 *     await ctx.reply('ops ack'); // replies through the 'ops' account
 *   }
 * }
 * ```
 *
 * KEY EXPORTS
 * -----------
 * - ON_USER_MESSAGE_METADATA: Metadata key the registrar reads for the filter.
 * - ON_USER_MESSAGE_CLIENT_METADATA: Metadata key for the handler's target account.
 * - OnUserMessage: The method decorator.
 */

import { SetMetadata } from '@nestjs/common';
import { DEFAULT_CLIENT_NAME } from '../telegram-client.constants';
import type {
  OnUserMessageFilter,
  OnUserMessageOptions,
} from './on-user-message.types';

/** Metadata key under which a handler's {@link OnUserMessageFilter} is stored. */
export const ON_USER_MESSAGE_METADATA = 'nestjs-telegram:on-user-message';

/**
 * Metadata key under which a handler's **target account name** is stored
 * (`options.client`, defaulting to {@link DEFAULT_CLIENT_NAME}). Each account's
 * registrar reads it to subscribe only its own handlers, so a handler listens to
 * exactly one account in a multi-account app.
 */
export const ON_USER_MESSAGE_CLIENT_METADATA =
  'nestjs-telegram:on-user-message-client';

/**
 * Marks a provider method as a handler for inbound user-account messages.
 *
 * @param filter - Optional match criteria; omit to receive every message.
 * @param options - Optional routing; `client` scopes the handler to a named
 *   account (defaults to the default account).
 * @returns A method decorator that attaches the filter and target-account metadata.
 * @throws Never.
 *
 * @example
 * ```ts
 * @OnUserMessage({ chatId: '@mychannel' })
 * onChannelPost(message: GramMessage) { ... }
 *
 * @OnUserMessage({ incoming: true }, { client: 'ops' })
 * onOpsMessage(message: GramMessage) { ... }
 * ```
 */
export function OnUserMessage(
  filter: OnUserMessageFilter = {},
  options: OnUserMessageOptions = {},
): MethodDecorator {
  const client = options.client ?? DEFAULT_CLIENT_NAME;
  return (target, propertyKey, descriptor) => {
    // ── Two markers: the match filter + which account this handler serves. ────
    SetMetadata(ON_USER_MESSAGE_METADATA, filter)(target, propertyKey, descriptor);
    SetMetadata(ON_USER_MESSAGE_CLIENT_METADATA, client)(
      target,
      propertyKey,
      descriptor,
    );
  };
}
