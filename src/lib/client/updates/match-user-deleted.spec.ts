/**
 * @file src/lib/client/updates/match-user-deleted.spec.ts
 *
 * PURPOSE
 * -------
 * Unit tests for the deleted-messages filter predicate.
 */

import type { GramDeletedMessages } from '../gram-client.types';
import { matchesUserDeletedFilter } from './match-user-deleted';

/** Builds a deletion event with overridable fields. */
function del(
  overrides: Partial<GramDeletedMessages> = {},
): GramDeletedMessages {
  return { messageIds: [1, 2], peerId: '555', ...overrides };
}

describe('matchesUserDeletedFilter', () => {
  it('matches everything for an empty filter', () => {
    expect(matchesUserDeletedFilter(del(), {})).toBe(true);
    expect(matchesUserDeletedFilter(del({ peerId: undefined }), {})).toBe(true);
  });

  describe('chatId', () => {
    it('matches a single id', () => {
      expect(
        matchesUserDeletedFilter(del({ peerId: '555' }), { chatId: 555 }),
      ).toBe(true);
      expect(
        matchesUserDeletedFilter(del({ peerId: '777' }), { chatId: 555 }),
      ).toBe(false);
    });

    it('matches any id in an array', () => {
      expect(
        matchesUserDeletedFilter(del({ peerId: '777' }), {
          chatId: ['555', '777'],
        }),
      ).toBe(true);
    });

    it('never matches a chatId filter when the event carries no peer', () => {
      // ── Telegram omits the peer outside channels/supergroups, so a chatId
      //    filter cannot be satisfied. ──────────────────────────────────────────
      expect(
        matchesUserDeletedFilter(del({ peerId: undefined }), { chatId: '555' }),
      ).toBe(false);
    });
  });
});
