/**
 * @file src/lib/testing/mock-bot-context.spec.ts
 *
 * PURPOSE
 * -------
 * Verifies the public Bot API test seam: that {@link createMockBotContext}
 * returns a spyable Telegraf `Context` with pre-stubbed reply methods and
 * sensible update data, honours overrides, and feeds the library's own
 * argument-resolver the values a real context would.
 */

import type { Context } from 'telegraf';
import { resolveHandlerArguments } from '../bot/updates/argument-resolver';
import { PARAM_KINDS } from '../bot/updates/telegram-update.types';
import { createMockBotContext } from './mock-bot-context';

describe('createMockBotContext', () => {
  it('pre-stubs the common reply/answer methods as jest spies', () => {
    const ctx = createMockBotContext();
    const spied = [
      ctx.reply,
      ctx.replyWithHTML,
      ctx.replyWithMarkdownV2,
      ctx.replyWithPhoto,
      ctx.replyWithDocument,
      ctx.answerCbQuery,
      ctx.editMessageText,
      ctx.editMessageReplyMarkup,
      ctx.deleteMessage,
      ctx.sendChatAction,
      ctx.leaveChat,
    ];
    for (const fn of spied) expect(jest.isMockFunction(fn)).toBe(true);
  });

  it('populates sensible default update data', () => {
    const ctx = createMockBotContext();
    expect(ctx.from).toEqual({ id: 1, is_bot: false, first_name: 'Test' });
    expect(ctx.chat).toEqual({ id: 1, type: 'private' });
  });

  it('records calls so a handler can be asserted on', async () => {
    const ctx = createMockBotContext();

    // A representative handler under test.
    const handler = async (c: Context): Promise<void> => {
      await c.reply('Welcome!');
    };
    await handler(ctx);

    expect(ctx.reply).toHaveBeenCalledWith('Welcome!');
  });

  it('overrides defaults from the partial', () => {
    const ctx = createMockBotContext({
      text: '/start',
      from: { id: 99, is_bot: false, first_name: 'Ada' },
    });
    expect(ctx.text).toBe('/start');
    expect(ctx.from).toEqual({ id: 99, is_bot: false, first_name: 'Ada' });
    // Untouched stubs still present.
    expect(jest.isMockFunction(ctx.reply)).toBe(true);
  });

  it('lets the partial replace a stubbed method with a canned spy', async () => {
    const reply = jest.fn().mockResolvedValue({ message_id: 7 });
    const ctx = createMockBotContext({ reply });

    await expect(ctx.reply('hi')).resolves.toEqual({ message_id: 7 });
    expect(reply).toHaveBeenCalledWith('hi');
  });

  it('feeds the library argument-resolver real-looking values', () => {
    const ctx = createMockBotContext({ text: 'hello' });

    // No decorators → the raw context is the single argument.
    expect(resolveHandlerArguments(ctx, [])).toEqual([ctx]);

    // Decorated slots pull from the context the same way a live update would.
    expect(
      resolveHandlerArguments(ctx, [
        { index: 0, kind: PARAM_KINDS.MESSAGE_TEXT },
        { index: 1, kind: PARAM_KINDS.SENDER },
      ]),
    ).toEqual(['hello', { id: 1, is_bot: false, first_name: 'Test' }]);
  });
});
