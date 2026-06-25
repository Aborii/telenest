/**
 * @file src/lib/client/updates/match-chat-action.ts
 *
 * PURPOSE
 * -------
 * Pure predicate deciding whether a {@link GramChatActionEvent} satisfies an
 * {@link OnChatActionFilter}. Extracted as a standalone function so the match
 * logic is trivially unit-testable, independent of NestJS or GramJS.
 *
 * USAGE
 * -----
 * import { matchesChatActionFilter } from './match-chat-action';
 *
 * KEY EXPORTS
 * -----------
 * - matchesChatActionFilter: The predicate.
 */

import type { GramChatActionEvent } from '../gram-client.types';
import type { OnChatActionFilter } from './on-chat-action.types';

/**
 * Tests a chat-action event against a filter. All present filter fields must
 * match (logical AND); absent fields are ignored.
 *
 * @param event - The chat-action event to test.
 * @param filter - The criteria to match against.
 * @returns `true` when the event satisfies every present criterion.
 * @throws Never.
 *
 * @example
 * ```ts
 * matchesChatActionFilter(event, { actions: ['typing'] });
 * ```
 */
export function matchesChatActionFilter(
  event: GramChatActionEvent,
  filter: OnChatActionFilter,
): boolean {
  // ── Chat allowlist: compare ids as strings (peer ids exceed 2^53). ────────
  if (filter.chatId !== undefined) {
    const allowed = (
      Array.isArray(filter.chatId) ? filter.chatId : [filter.chatId]
    ).map((id) => String(id));
    if (!allowed.includes(event.peerId)) return false;
  }

  // ── Action allowlist: accept a single kind or a list of kinds. ────────────
  if (filter.actions !== undefined) {
    const allowed = Array.isArray(filter.actions)
      ? filter.actions
      : [filter.actions];
    if (!allowed.includes(event.action)) return false;
  }

  return true;
}
