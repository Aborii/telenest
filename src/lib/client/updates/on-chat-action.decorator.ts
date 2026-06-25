/**
 * @file src/lib/client/updates/on-chat-action.decorator.ts
 *
 * PURPOSE
 * -------
 * The `@OnChatAction` method decorator. It tags a provider method so the
 * {@link import('./telegram-user-updates.registrar').TelegramUserUpdatesRegistrar}
 * subscribes it to the account's **chat-action** stream (filtered) at bootstrap.
 * The handler receives a {@link import('../gram-client.types').GramChatActionEvent}
 * (typing / recording / online / offline / …).
 *
 * USAGE
 * -----
 * ```ts
 * @Injectable()
 * class PresenceWatcher {
 *   @OnChatAction({ actions: ['online', 'offline'] })
 *   onPresence(event: GramChatActionEvent) {
 *     // event.peerId, event.userId, event.action
 *   }
 * }
 * ```
 *
 * KEY EXPORTS
 * -----------
 * - ON_CHAT_ACTION_METADATA: Metadata key the registrar reads for the filter.
 * - ON_CHAT_ACTION_CLIENT_METADATA: Metadata key for the handler's target account.
 * - OnChatAction: The method decorator.
 */

import { SetMetadata } from '@nestjs/common';

import { DEFAULT_CLIENT_NAME } from '../telegram-client.constants';
import type { OnChatActionFilter } from './on-chat-action.types';
import type { OnUserMessageOptions } from './on-user-message.types';

/** Metadata key under which a handler's {@link OnChatActionFilter} is stored. */
export const ON_CHAT_ACTION_METADATA = 'nestjs-telegram:on-chat-action';

/**
 * Metadata key under which an `@OnChatAction` handler's **target account name**
 * is stored (`options.client`, defaulting to {@link DEFAULT_CLIENT_NAME}). Each
 * account's registrar reads it to subscribe only its own handlers.
 */
export const ON_CHAT_ACTION_CLIENT_METADATA =
  'nestjs-telegram:on-chat-action-client';

/**
 * Marks a provider method as a handler for user-account **chat actions**
 * (typing / recording / online / offline / …).
 *
 * @param filter - Optional match criteria; omit to receive every action. A
 *   `chatId` allowlist and/or an `actions` kind allowlist are supported.
 * @param options - Optional routing; `client` scopes the handler to a named
 *   account (defaults to the default account).
 * @returns A method decorator that attaches the filter and target-account metadata.
 * @throws Never.
 *
 * @example
 * ```ts
 * @OnChatAction({ chatId: '@mygroup', actions: 'typing' })
 * onGroupTyping(event: GramChatActionEvent) { ... }
 * ```
 */
export function OnChatAction(
  filter: OnChatActionFilter = {},
  options: OnUserMessageOptions = {},
): MethodDecorator {
  const client = options.client ?? DEFAULT_CLIENT_NAME;
  return (target, propertyKey, descriptor) => {
    // ── Two markers: the match filter + which account this handler serves. ────
    SetMetadata(ON_CHAT_ACTION_METADATA, filter)(
      target,
      propertyKey,
      descriptor,
    );
    SetMetadata(ON_CHAT_ACTION_CLIENT_METADATA, client)(
      target,
      propertyKey,
      descriptor,
    );
  };
}
