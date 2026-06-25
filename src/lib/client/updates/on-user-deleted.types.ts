/**
 * @file src/lib/client/updates/on-user-deleted.types.ts
 *
 * PURPOSE
 * -------
 * Public types for the `@OnUserDeleted` update system: the filter accepted by
 * {@link import('./on-user-deleted.decorator').OnUserDeleted} and the handler
 * shape it tags.
 *
 * A deletion event carries no message body or direction, so — unlike
 * {@link import('./on-user-message.types').OnUserMessageFilter} — its filter
 * supports only a chat allowlist. (Telegram reports the originating chat for
 * channel/supergroup deletions only, so a `chatId` filter is effective just for
 * those; see {@link import('../gram-client.types').GramDeletedMessages}.)
 *
 * USAGE
 * -----
 * ```ts
 * @OnUserDeleted({ chatId: '@mychannel' })
 * onDeleted(event: GramDeletedMessages) { ... }
 * ```
 *
 * KEY EXPORTS
 * -----------
 * - OnUserDeletedFilter: Declarative match criteria for a deletion handler.
 * - OnUserDeletedHandler: Shape of a method decorated with `@OnUserDeleted`.
 */

import type { GramDeletedMessages, GramPeer } from '../gram-client.types';

/**
 * Declarative criteria deciding whether a deletion event is dispatched to a
 * decorated handler. All present fields must match (logical AND); omitting a
 * field means "don't care".
 */
export interface OnUserDeletedFilter {
  /**
   * Restrict to one or more chat/peer ids (matched against the event's
   * `peerId`). Because Telegram only reports the peer for channel/supergroup
   * deletions, a deletion with no `peerId` never matches a `chatId` filter.
   */
  chatId?: GramPeer | readonly GramPeer[];
}

/** Shape of a method decorated with `@OnUserDeleted`. */
export type OnUserDeletedHandler = (
  event: GramDeletedMessages,
) => unknown | Promise<unknown>;
