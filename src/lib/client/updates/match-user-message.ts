/**
 * @file src/lib/client/updates/match-user-message.ts
 *
 * PURPOSE
 * -------
 * Pure predicate deciding whether a {@link GramMessage} satisfies an
 * {@link OnUserMessageFilter}. Extracted as a standalone function so the match
 * logic is trivially unit-testable, independent of NestJS or GramJS.
 *
 * USAGE
 * -----
 * import { matchesUserMessageFilter } from './match-user-message';
 *
 * KEY EXPORTS
 * -----------
 * - matchesUserMessageFilter: The predicate.
 */

import type { GramMessage } from '../gram-client.types';
import type { OnUserMessageFilter } from './on-user-message.types';

/**
 * Tests a message against a filter. All present filter fields must match
 * (logical AND); absent fields are ignored.
 *
 * @param message - The inbound message to test.
 * @param filter - The criteria to match against.
 * @returns `true` when the message satisfies every present criterion.
 * @throws Never.
 *
 * @example
 * ```ts
 * matchesUserMessageFilter(msg, { incoming: true, pattern: /hi/ });
 * ```
 */
export function matchesUserMessageFilter(
  message: GramMessage,
  filter: OnUserMessageFilter,
): boolean {
  // ── Direction: `incoming` requires a message NOT sent by self; `outgoing`
  //    requires one sent by self. Both unset matches either direction. ───────
  if (filter.incoming === true && message.out) return false;
  if (filter.outgoing === true && !message.out) return false;

  // ── Text pattern: RegExp is tested; a string must match exactly. ──────────
  if (filter.pattern !== undefined) {
    if (filter.pattern instanceof RegExp) {
      if (!filter.pattern.test(message.text)) return false;
    } else if (message.text !== filter.pattern) {
      return false;
    }
  }

  // ── Chat allowlist: compare ids as strings (peer ids exceed 2^53). ────────
  if (filter.chatId !== undefined) {
    const allowed = (
      Array.isArray(filter.chatId) ? filter.chatId : [filter.chatId]
    ).map((id) => String(id));
    if (!allowed.includes(message.peerId)) return false;
  }

  return true;
}
