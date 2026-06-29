/**
 * @file src/lib/client/updates/match-chat-action.spec.ts
 *
 * PURPOSE
 * -------
 * Unit tests for the chat-action filter predicate.
 */

import {
  GRAM_CHAT_ACTIONS,
  type GramChatActionEvent,
} from '../gram-client.types';
import { matchesChatActionFilter } from './match-chat-action';

/** Builds a chat-action event with overridable fields. */
function act(
  overrides: Partial<GramChatActionEvent> = {},
): GramChatActionEvent {
  return {
    peerId: '555',
    userId: '555',
    action: GRAM_CHAT_ACTIONS.TYPING,
    ...overrides,
  };
}

describe('matchesChatActionFilter', () => {
  it('matches everything for an empty filter', () => {
    expect(matchesChatActionFilter(act(), {})).toBe(true);
  });

  describe('chatId', () => {
    it('matches a single id and rejects others', () => {
      expect(
        matchesChatActionFilter(act({ peerId: '555' }), { chatId: 555 }),
      ).toBe(true);
      expect(
        matchesChatActionFilter(act({ peerId: '777' }), { chatId: 555 }),
      ).toBe(false);
    });
  });

  describe('actions', () => {
    it('matches a single action kind', () => {
      expect(
        matchesChatActionFilter(act({ action: GRAM_CHAT_ACTIONS.ONLINE }), {
          actions: GRAM_CHAT_ACTIONS.ONLINE,
        }),
      ).toBe(true);
      expect(
        matchesChatActionFilter(act({ action: GRAM_CHAT_ACTIONS.OFFLINE }), {
          actions: GRAM_CHAT_ACTIONS.ONLINE,
        }),
      ).toBe(false);
    });

    it('matches any kind in a list', () => {
      expect(
        matchesChatActionFilter(act({ action: GRAM_CHAT_ACTIONS.OFFLINE }), {
          actions: [GRAM_CHAT_ACTIONS.ONLINE, GRAM_CHAT_ACTIONS.OFFLINE],
        }),
      ).toBe(true);
    });
  });

  it('ANDs chat and action criteria', () => {
    const event = act({ peerId: '555', action: GRAM_CHAT_ACTIONS.TYPING });
    expect(
      matchesChatActionFilter(event, {
        chatId: '555',
        actions: GRAM_CHAT_ACTIONS.TYPING,
      }),
    ).toBe(true);
    // One mismatch (wrong action) fails the whole filter.
    expect(
      matchesChatActionFilter(event, {
        chatId: '555',
        actions: GRAM_CHAT_ACTIONS.ONLINE,
      }),
    ).toBe(false);
  });
});
