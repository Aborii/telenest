/**
 * @file src/lib/client/updates/match-user-deleted.ts
 *
 * PURPOSE
 * -------
 * Pure predicate deciding whether a {@link GramDeletedMessages} event satisfies
 * an {@link OnUserDeletedFilter}. Extracted as a standalone function so the match
 * logic is trivially unit-testable, independent of NestJS or GramJS.
 *
 * USAGE
 * -----
 * import { matchesUserDeletedFilter } from './match-user-deleted';
 *
 * KEY EXPORTS
 * -----------
 * - matchesUserDeletedFilter: The predicate.
 */

import type { GramDeletedMessages } from '../gram-client.types';
import type { OnUserDeletedFilter } from './on-user-deleted.types';

/**
 * Tests a deletion event against a filter. All present filter fields must match
 * (logical AND); absent fields are ignored.
 *
 * @param event - The deletion event to test.
 * @param filter - The criteria to match against.
 * @returns `true` when the event satisfies every present criterion.
 * @throws Never.
 *
 * @example
 * ```ts
 * matchesUserDeletedFilter(event, { chatId: '@mychannel' });
 * ```
 */
export function matchesUserDeletedFilter(
  event: GramDeletedMessages,
  filter: OnUserDeletedFilter,
): boolean {
  // ── Chat allowlist: compare ids as strings (peer ids exceed 2^53). Telegram
  //    omits the peer outside channels/supergroups, so an event with no peerId
  //    can never satisfy a chatId filter. ─────────────────────────────────────
  if (filter.chatId !== undefined) {
    if (event.peerId === undefined) return false;
    const allowed = (
      Array.isArray(filter.chatId) ? filter.chatId : [filter.chatId]
    ).map((id) => String(id));
    if (!allowed.includes(event.peerId)) return false;
  }

  return true;
}
