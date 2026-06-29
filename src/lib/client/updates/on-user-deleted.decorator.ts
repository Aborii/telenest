/**
 * @file src/lib/client/updates/on-user-deleted.decorator.ts
 *
 * PURPOSE
 * -------
 * The `@OnUserDeleted` method decorator. It tags a provider method so the
 * {@link import('./telegram-user-updates.registrar').TelegramUserUpdatesRegistrar}
 * subscribes it to the account's **deleted-message** stream (filtered) at
 * bootstrap. The handler receives a
 * {@link import('../gram-client.types').GramDeletedMessages} (deleted ids plus,
 * for channels/supergroups, the originating peer).
 *
 * USAGE
 * -----
 * ```ts
 * @Injectable()
 * class DeletionAuditor {
 *   @OnUserDeleted()
 *   onDeleted(event: GramDeletedMessages) {
 *     // event.messageIds, event.peerId (channels only)
 *   }
 * }
 * ```
 *
 * KEY EXPORTS
 * -----------
 * - ON_USER_DELETED_METADATA: Metadata key the registrar reads for the filter.
 * - ON_USER_DELETED_CLIENT_METADATA: Metadata key for the handler's target account.
 * - OnUserDeleted: The method decorator.
 */

import { SetMetadata } from '@nestjs/common';

import { DEFAULT_CLIENT_NAME } from '../telegram-client.constants';
import type { OnUserDeletedFilter } from './on-user-deleted.types';
import type { OnUserMessageOptions } from './on-user-message.types';

/** Metadata key under which a handler's {@link OnUserDeletedFilter} is stored. */
export const ON_USER_DELETED_METADATA = 'nestjs-telegram:on-user-deleted';

/**
 * Metadata key under which an `@OnUserDeleted` handler's **target account name**
 * is stored (`options.client`, defaulting to {@link DEFAULT_CLIENT_NAME}). Each
 * account's registrar reads it to subscribe only its own handlers.
 */
export const ON_USER_DELETED_CLIENT_METADATA =
  'nestjs-telegram:on-user-deleted-client';

/**
 * Marks a provider method as a handler for **deleted** user-account messages.
 *
 * @param filter - Optional match criteria; omit to receive every deletion. Only
 *   a `chatId` allowlist is supported (a deletion carries no body/direction).
 * @param options - Optional routing; `client` scopes the handler to a named
 *   account (defaults to the default account).
 * @returns A method decorator that attaches the filter and target-account metadata.
 * @throws Never.
 *
 * @example
 * ```ts
 * @OnUserDeleted({ chatId: '@mychannel' }, { client: 'ops' })
 * onOpsDeleted(event: GramDeletedMessages) { ... }
 * ```
 */
export function OnUserDeleted(
  filter: OnUserDeletedFilter = {},
  options: OnUserMessageOptions = {},
): MethodDecorator {
  const client = options.client ?? DEFAULT_CLIENT_NAME;
  return (target, propertyKey, descriptor) => {
    // ── Two markers: the match filter + which account this handler serves. ────
    SetMetadata(ON_USER_DELETED_METADATA, filter)(
      target,
      propertyKey,
      descriptor,
    );
    SetMetadata(ON_USER_DELETED_CLIENT_METADATA, client)(
      target,
      propertyKey,
      descriptor,
    );
  };
}
