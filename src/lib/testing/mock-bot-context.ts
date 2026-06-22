/**
 * @file src/lib/testing/mock-bot-context.ts
 *
 * PURPOSE
 * -------
 * Public test seam for the Bot API side. Builds a spyable stand-in for
 * Telegraf's {@link Context} so a consumer can unit-test an update handler
 * without a running bot or the network. The common reply/answer methods a
 * handler calls are pre-stubbed as `jest.fn()` spies; the common update data
 * (`from`, `chat`) is pre-populated and fully overridable.
 *
 * The `telegraf` dependency is **type-only** (erased at compile time) and the
 * `jest` reference is the **ambient global** of a Jest runtime — this module
 * never `import`s either at runtime, so the `nestjs-telegram/testing` subpath
 * stays free of a hard Telegraf or test-runner dependency. Call
 * {@link createMockBotContext} only from inside Jest specs.
 *
 * USAGE
 * -----
 * ```ts
 * import { createMockBotContext } from 'nestjs-telegram/testing';
 *
 * const ctx = createMockBotContext({ text: '/start' });
 * await myHandler(ctx);
 * expect(ctx.reply).toHaveBeenCalledWith('Welcome!');
 * ```
 *
 * KEY EXPORTS
 * -----------
 * - createMockBotContext: Builds a spyable Telegraf {@link Context}.
 */

import type { Context } from 'telegraf';

/**
 * Builds a spyable stand-in for a Telegraf {@link Context}. The returned object
 * is **not** a real `Context` instance — it is a partial mock exposing only the
 * members a handler typically touches, cast to `Context` for ergonomic typing:
 *
 * - Reply/answer methods (`reply`, `replyWithHTML`, `replyWithMarkdownV2`,
 *   `replyWithPhoto`, `replyWithDocument`, `answerCbQuery`, `editMessageText`,
 *   `editMessageReplyMarkup`, `deleteMessage`, `sendChatAction`, `leaveChat`)
 *   are `jest.fn()` spies, so you can assert how your handler responded.
 * - Update data (`from`, `chat`) is pre-populated with a private-chat user and
 *   overridable via `partial` (e.g. supply `text`, `callbackQuery`, `message`).
 *
 * Anything you pass in `partial` overrides the defaults, so you can attach extra
 * spies or replace the stubbed methods with ones that return canned values.
 *
 * @param partial - Context members to add or override on the mock.
 * @returns A `Context` whose stubbed methods are Jest spies.
 * @throws {ReferenceError} If called outside a Jest runtime (no ambient `jest`).
 * @example
 * ```ts
 * const ctx = createMockBotContext({
 *   callbackQuery: { id: 'q1', data: 'confirm' } as Context['callbackQuery'],
 * });
 * await onConfirm(ctx);
 * expect(ctx.answerCbQuery).toHaveBeenCalled();
 * ```
 */
export function createMockBotContext(partial: Partial<Context> = {}): Context {
  // ── Spyable Bot API replies/answers — the methods handlers call most. ──
  const base = {
    reply: jest.fn(),
    replyWithHTML: jest.fn(),
    replyWithMarkdownV2: jest.fn(),
    replyWithPhoto: jest.fn(),
    replyWithDocument: jest.fn(),
    answerCbQuery: jest.fn(),
    editMessageText: jest.fn(),
    editMessageReplyMarkup: jest.fn(),
    deleteMessage: jest.fn(),
    sendChatAction: jest.fn(),
    leaveChat: jest.fn(),
    // ── Common update data, overridable via `partial`. ──
    from: { id: 1, is_bot: false, first_name: 'Test' },
    chat: { id: 1, type: 'private' },
  };

  // Casting through `unknown`: we deliberately return a partial, spyable
  // stand-in for Telegraf's large `Context` class — only the members a handler
  // touches — rather than constructing a real (network-bound) instance.
  return { ...base, ...partial } as unknown as Context;
}
