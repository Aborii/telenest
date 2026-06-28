/**
 * @file src/lib/testing/mock-bot-context.ts
 *
 * PURPOSE
 * -------
 * Public test seam for the Bot API side. Builds a spyable stand-in for
 * Telegraf's {@link Context} so a consumer can unit-test an update handler
 * without a running bot or the network. Every reply / answer / edit /
 * chat-management method a handler commonly calls is pre-stubbed as a
 * `jest.fn()` spy, and the common update data (`from`, `chat`), the mutable
 * `state` bag, and a minimal `telegram` / `botInfo` are pre-populated and fully
 * overridable.
 *
 * The `telegraf` dependency is **type-only** (erased at compile time) and the
 * `jest` reference is the **ambient global** of a Jest runtime — this module
 * never `import`s either at runtime, so the `telenest/testing` subpath
 * stays free of a hard Telegraf or test-runner dependency. Call
 * {@link createMockBotContext} only from inside Jest specs.
 *
 * USAGE
 * -----
 * ```ts
 * import { createMockBotContext } from 'telenest/testing';
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
 * - **Replies & sends** (`reply`, `replyWithHTML`, `replyWithMarkdown`,
 *   `replyWithMarkdownV2`, `sendMessage`) and **media replies**
 *   (`replyWithPhoto`, `replyWithDocument`, `replyWithAudio`, `replyWithVideo`,
 *   `replyWithAnimation`, `replyWithSticker`, `replyWithVoice`,
 *   `replyWithLocation`, `replyWithContact`, `replyWithPoll`, `replyWithDice`,
 *   `replyWithMediaGroup`, `replyWithInvoice`).
 * - **Answers** (`answerCbQuery`, `answerInlineQuery`, `answerShippingQuery`,
 *   `answerPreCheckoutQuery`) and **edits** (`editMessageText`,
 *   `editMessageCaption`, `editMessageReplyMarkup`, `deleteMessage`).
 * - **Chat management** (`getChat`, `leaveChat`, `sendChatAction`,
 *   `pinChatMessage`, `unpinChatMessage`, `banChatMember`, `unbanChatMember`,
 *   `restrictChatMember`, `promoteChatMember`).
 *
 * Every one of the above is a `jest.fn()` spy, so you can assert how your
 * handler responded. Update data (`from`, `chat`) is pre-populated with a
 * private-chat user, the mutable `state` bag is an empty object, and a minimal
 * `telegram` / `botInfo` are provided — all overridable via `partial` (e.g.
 * supply `text`, `callbackQuery`, `message`, or session/scene fields).
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
  const base = {
    // ── Replies & sends ──────────────────────────────────────────────────
    reply: jest.fn(),
    replyWithHTML: jest.fn(),
    replyWithMarkdown: jest.fn(),
    replyWithMarkdownV2: jest.fn(),
    sendMessage: jest.fn(),

    // ── Media replies ────────────────────────────────────────────────────
    replyWithPhoto: jest.fn(),
    replyWithDocument: jest.fn(),
    replyWithAudio: jest.fn(),
    replyWithVideo: jest.fn(),
    replyWithAnimation: jest.fn(),
    replyWithSticker: jest.fn(),
    replyWithVoice: jest.fn(),
    replyWithLocation: jest.fn(),
    replyWithContact: jest.fn(),
    replyWithPoll: jest.fn(),
    replyWithDice: jest.fn(),
    replyWithMediaGroup: jest.fn(),
    replyWithInvoice: jest.fn(),

    // ── Callback / inline / checkout answers ─────────────────────────────
    answerCbQuery: jest.fn(),
    answerInlineQuery: jest.fn(),
    answerShippingQuery: jest.fn(),
    answerPreCheckoutQuery: jest.fn(),

    // ── Message editing ──────────────────────────────────────────────────
    editMessageText: jest.fn(),
    editMessageCaption: jest.fn(),
    editMessageReplyMarkup: jest.fn(),
    deleteMessage: jest.fn(),

    // ── Chat management ──────────────────────────────────────────────────
    getChat: jest.fn(),
    leaveChat: jest.fn(),
    sendChatAction: jest.fn(),
    pinChatMessage: jest.fn(),
    unpinChatMessage: jest.fn(),
    banChatMember: jest.fn(),
    unbanChatMember: jest.fn(),
    restrictChatMember: jest.fn(),
    promoteChatMember: jest.fn(),

    // ── Common update data & state, all overridable via `partial`. ───────
    from: { id: 1, is_bot: false, first_name: 'Test' },
    chat: { id: 1, type: 'private' },
    /** Mutable per-update bag Telegraf session / scene middleware writes to. */
    state: {},
    /** Minimal raw Telegram API client for handlers that reach past replies. */
    telegram: { sendMessage: jest.fn(), getMe: jest.fn() },
    /** Bot identity some handlers read (e.g. to build deep links). */
    botInfo: {
      id: 1,
      is_bot: true,
      first_name: 'TestBot',
      username: 'test_bot',
      can_join_groups: false,
      can_read_all_group_messages: false,
      supports_inline_queries: false,
    },
  };

  // Casting through `unknown`: we deliberately return a partial, spyable
  // stand-in for Telegraf's large `Context` class — only the members a handler
  // touches — rather than constructing a real (network-bound) instance.
  return { ...base, ...partial } as unknown as Context;
}
