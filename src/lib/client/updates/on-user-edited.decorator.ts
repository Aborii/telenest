/**
 * @file src/lib/client/updates/on-user-edited.decorator.ts
 *
 * PURPOSE
 * -------
 * The `@OnUserEdited` method decorator. It tags a provider method so the
 * {@link import('./telegram-user-updates.registrar').TelegramUserUpdatesRegistrar}
 * subscribes it to the account's **edited-message** stream (filtered) at
 * bootstrap. An edited message is delivered as a normal
 * {@link import('../gram-client.types').GramMessage} whose `text` reflects the
 * new content, so it accepts the same {@link OnUserMessageFilter} (direction /
 * pattern / chat) and the same `{ client }` account scoping as `@OnUserMessage`.
 *
 * USAGE
 * -----
 * ```ts
 * @Injectable()
 * class EditWatcher {
 *   @OnUserEdited({ incoming: true })
 *   onEdit(message: GramMessage, ctx: GramUserMessageContext) {
 *     // `message.text` is the edited content.
 *   }
 * }
 * ```
 *
 * KEY EXPORTS
 * -----------
 * - ON_USER_EDITED_METADATA: Metadata key the registrar reads for the filter.
 * - ON_USER_EDITED_CLIENT_METADATA: Metadata key for the handler's target account.
 * - OnUserEdited: The method decorator.
 */

import { SetMetadata } from '@nestjs/common';

import { DEFAULT_CLIENT_NAME } from '../telegram-client.constants';
import type {
  OnUserMessageFilter,
  OnUserMessageOptions,
} from './on-user-message.types';

/** Metadata key under which a handler's edited-message {@link OnUserMessageFilter} is stored. */
export const ON_USER_EDITED_METADATA = 'nestjs-telegram:on-user-edited';

/**
 * Metadata key under which an `@OnUserEdited` handler's **target account name**
 * is stored (`options.client`, defaulting to {@link DEFAULT_CLIENT_NAME}). Each
 * account's registrar reads it to subscribe only its own handlers.
 */
export const ON_USER_EDITED_CLIENT_METADATA =
  'nestjs-telegram:on-user-edited-client';

/**
 * Marks a provider method as a handler for **edited** user-account messages.
 *
 * @param filter - Optional match criteria; omit to receive every edit. The same
 *   {@link OnUserMessageFilter} as `@OnUserMessage` (direction / pattern / chat),
 *   evaluated against the edited message.
 * @param options - Optional routing; `client` scopes the handler to a named
 *   account (defaults to the default account).
 * @returns A method decorator that attaches the filter and target-account metadata.
 * @throws Never.
 *
 * @example
 * ```ts
 * @OnUserEdited({ chatId: '@mychannel' })
 * onChannelEdit(message: GramMessage) { ... }
 * ```
 */
export function OnUserEdited(
  filter: OnUserMessageFilter = {},
  options: OnUserMessageOptions = {},
): MethodDecorator {
  const client = options.client ?? DEFAULT_CLIENT_NAME;
  return (target, propertyKey, descriptor) => {
    // ── Two markers: the match filter + which account this handler serves. ────
    SetMetadata(ON_USER_EDITED_METADATA, filter)(
      target,
      propertyKey,
      descriptor,
    );
    SetMetadata(ON_USER_EDITED_CLIENT_METADATA, client)(
      target,
      propertyKey,
      descriptor,
    );
  };
}
