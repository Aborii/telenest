/**
 * @file src/lib/bot/telegram-bot.delegation.spec.ts
 *
 * PURPOSE
 * -------
 * Data-driven coverage for the Bot API facade's delegating methods. Every
 * method forwards its arguments verbatim to the underlying Telegraf `telegram`
 * client and wraps any failure in a {@link TelegramBotApiError}; this spec
 * asserts both behaviours across the full method surface at once.
 */

import type { Telegraf } from 'telegraf';

import { TelegramBotApiError } from '../common';
import { TelegramBotService } from './telegram-bot.service';

/** Generic signature for dynamically-invoked facade methods. */
type AnyAsyncFn = (...args: unknown[]) => Promise<unknown>;

/** The delegating methods and a representative argument list for each. */
const DELEGATIONS: ReadonlyArray<{ method: string; args: unknown[] }> = [
  { method: 'sendPhoto', args: [1, 'file-id'] },
  { method: 'sendDocument', args: [1, 'file-id'] },
  { method: 'sendVideo', args: [1, 'file-id'] },
  { method: 'sendAudio', args: [1, 'file-id'] },
  { method: 'sendMediaGroup', args: [1, []] },
  { method: 'sendLocation', args: [1, 51.5, -0.12] },
  { method: 'sendChatAction', args: [1, 'typing'] },
  { method: 'forwardMessage', args: [2, 1, 99] },
  { method: 'copyMessage', args: [2, 1, 99] },
  { method: 'editMessageText', args: [1, 99, undefined, 'new'] },
  { method: 'editMessageReplyMarkup', args: [1, 99, undefined, undefined] },
  { method: 'deleteMessage', args: [1, 99] },
  { method: 'answerCbQuery', args: ['cbid', 'ok'] },
  { method: 'getChat', args: [1] },
  { method: 'getChatMembersCount', args: [1] },
  { method: 'banChatMember', args: [1, 5] },
  { method: 'pinChatMessage', args: [1, 99] },
  { method: 'setMyCommands', args: [[]] },
  { method: 'getMyCommands', args: [] },
  { method: 'getFile', args: ['file-id'] },
  { method: 'getFileLink', args: ['file-id'] },
  { method: 'setWebhook', args: ['https://x/h'] },
  { method: 'deleteWebhook', args: [] },
  { method: 'getWebhookInfo', args: [] },
  // ── Polls, stickers & reactions ──
  { method: 'sendPoll', args: [1, 'Q?', ['a', 'b']] },
  { method: 'stopPoll', args: [1, 99] },
  { method: 'sendSticker', args: [1, 'sticker-id'] },
  {
    method: 'setMessageReaction',
    args: [1, 99, [{ type: 'emoji', emoji: '👍' }]],
  },
  // ── Forum topics ──
  { method: 'createForumTopic', args: [1, 'Topic'] },
  { method: 'editForumTopic', args: [1, 5, { name: 'New' }] },
  { method: 'closeForumTopic', args: [1, 5] },
  { method: 'reopenForumTopic', args: [1, 5] },
  { method: 'deleteForumTopic', args: [1, 5] },
  // ── Payments ──
  { method: 'sendInvoice', args: [1, { title: 'X' }] },
  { method: 'createInvoiceLink', args: [{ title: 'X' }] },
  { method: 'answerPreCheckoutQuery', args: ['pcq-id', true] },
  // ── Bot profile & menu button ──
  { method: 'setChatMenuButton', args: [{ chatId: 1 }] },
  { method: 'getChatMenuButton', args: [{ chatId: 1 }] },
  { method: 'setMyDescription', args: ['desc'] },
  { method: 'getMyDescription', args: [] },
  { method: 'setMyShortDescription', args: ['short'] },
  { method: 'getMyShortDescription', args: [] },
];

/** Builds a service whose mock `telegram` exposes `method` as a jest fn. */
function serviceWith(
  method: string,
  impl: jest.Mock,
): {
  service: TelegramBotService;
  fn: jest.Mock;
} {
  const telegram: Record<string, jest.Mock> = { [method]: impl };
  const bot = {
    telegram,
    launch: jest.fn(),
    stop: jest.fn(),
  } as unknown as Telegraf;
  return {
    service: new TelegramBotService(bot, { token: 'x', launch: false }),
    fn: impl,
  };
}

describe('TelegramBotService delegation', () => {
  describe.each(DELEGATIONS)('$method', ({ method, args }) => {
    it('forwards arguments and returns the result', async () => {
      const { service, fn } = serviceWith(
        method,
        jest.fn().mockResolvedValue('RESULT'),
      );

      const invoke = (service as unknown as Record<string, AnyAsyncFn>)[
        method
      ] as AnyAsyncFn;
      const result = await invoke.apply(service, args);

      expect(fn).toHaveBeenCalledWith(...args);
      expect(result).toBe('RESULT');
    });

    it('wraps failures in TelegramBotApiError', async () => {
      const { service } = serviceWith(
        method,
        jest.fn().mockRejectedValue({ code: 400, message: 'Bad Request' }),
      );

      const invoke = (service as unknown as Record<string, AnyAsyncFn>)[
        method
      ] as AnyAsyncFn;
      await expect(invoke.apply(service, args)).rejects.toBeInstanceOf(
        TelegramBotApiError,
      );
    });
  });
});
