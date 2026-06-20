/**
 * @file src/lib/testing/mock-bot-context.ts
 *
 * PURPOSE
 * -------
 * Factory for a spyable Telegraf {@link Context} stand-in. Every action method
 * (reply, sendMessage, answerCbQuery, …) is replaced with a `jest.fn()` so
 * tests can verify which response methods a handler called without sending
 * any real messages to Telegram.
 *
 * The context is typed as `Partial<Context> & Record<string, unknown>` and cast
 * to `Context` — this is intentional and documented below. Using a real
 * `new Context(...)` would require a live `Telegram` instance and real bot-info
 * data, coupling tests to the network.
 *
 * USAGE
 * -----
 * ```ts
 * import { createMockBotContext } from 'nestjs-telegram/testing';
 *
 * const ctx = createMockBotContext({ text: 'hello' });
 * await myHandler(ctx);
 * expect(ctx.reply).toHaveBeenCalledWith('Hello, user!');
 * ```
 *
 * KEY EXPORTS
 * -----------
 * - MockBotContextOverrides: Partial shape accepted by the factory.
 * - createMockBotContext:    Returns a spy-equipped Telegraf Context.
 */

import type { Context } from 'telegraf';
import type { Update } from 'telegraf/types';

/**
 * Partial fields accepted by {@link createMockBotContext}. Every property is
 * optional; anything not supplied falls back to a sensible default or a
 * `jest.fn()` stub.
 *
 * The `update` field lets tests shape the incoming Telegram Update that the
 * context represents. If omitted a minimal message update is inserted.
 */
export interface MockBotContextOverrides {
  /** The Telegram Update object the context wraps. Defaults to a bare message update. */
  update?: Partial<Update>;
  /** Arbitrary extra fields to merge directly onto the context (e.g. `session`, `state`). */
  [key: string]: unknown;
}

/**
 * Creates a spyable Telegraf {@link Context} suitable for handler unit tests.
 * All action / response methods are stubbed with `jest.fn()` so you can assert
 * on calls without hitting the network.
 *
 * The returned object satisfies the `Context` interface at compile time via a
 * type assertion, but is constructed as a plain object — there is no live
 * `Telegraf` instance involved.
 *
 * @param overrides - Optional partial fields. `update` shapes the Telegram
 *   update; any other key is merged directly onto the context (e.g. `state`,
 *   session data, extra helpers).
 * @returns A `jest.Mocked`-style {@link Context} with stub methods.
 * @throws Never.
 *
 * @example
 * ```ts
 * const ctx = createMockBotContext({ update: { message: { text: '/start' } } });
 * await startHandler(ctx);
 * expect(ctx.reply).toHaveBeenCalledWith('Welcome!');
 * ```
 */
export function createMockBotContext(
  overrides: MockBotContextOverrides = {},
): jest.Mocked<Context> {
  // ── Destructure known shape keys from the overrides object ──────────────
  const { update: updateOverride, ...extraFields } = overrides;

  // ── Build a minimal message update so ctx.message is defined ────────────
  const update: Partial<Update> = {
    update_id: 1,
    ...updateOverride,
  };

  // ── Construct the context as a plain object with all stubs ──────────────
  // We cast via `unknown` because we are intentionally building a structural
  // mock rather than a real Context instance. Every method consumers typically
  // call is present as a jest.fn(); properties that vary per-update are set
  // from the `update` argument above.
  //
  // The `satisfies` constraint is intentionally omitted here: the Telegraf
  // `Telegram` type has 130+ methods and strict return types. Attempting to
  // conform to `Partial<Context>` at the object literal level produces dozens
  // of assignment errors for every stub. We build the plain mock object and
  // apply a single `as unknown as jest.Mocked<Context>` cast at the return
  // site, which is the standard Jest mocking pattern.
  const ctx: Record<string, unknown> = {
    // ── Core properties ──────────────────────────────────────────────────
    update: update as Update,
    /** Mock Telegram API client; individual methods can be spied on. */
    telegram: {
      sendMessage: jest.fn(),
      getMe: jest.fn(),
    },
    /** Bot info required by some Telegraf internals. */
    botInfo: {
      id: 1,
      is_bot: true,
      first_name: 'TestBot',
      username: 'test_bot',
      can_join_groups: false,
      can_read_all_group_messages: false,
      supports_inline_queries: false,
    },
    /** Mutable state bag — Telegraf session / scene middleware write here. */
    state: {},

    // ── Message shorthand ─────────────────────────────────────────────────
    reply: jest.fn().mockResolvedValue({}),
    replyWithHTML: jest.fn().mockResolvedValue({}),
    replyWithMarkdown: jest.fn().mockResolvedValue({}),
    replyWithMarkdownV2: jest.fn().mockResolvedValue({}),
    sendMessage: jest.fn().mockResolvedValue({}),

    // ── Callback-query answering ──────────────────────────────────────────
    answerCbQuery: jest.fn().mockResolvedValue(true),
    answerInlineQuery: jest.fn().mockResolvedValue(true),
    answerShippingQuery: jest.fn().mockResolvedValue(true),
    answerPreCheckoutQuery: jest.fn().mockResolvedValue(true),

    // ── Message editing ───────────────────────────────────────────────────
    editMessageText: jest.fn().mockResolvedValue({}),
    editMessageCaption: jest.fn().mockResolvedValue({}),
    editMessageReplyMarkup: jest.fn().mockResolvedValue({}),
    deleteMessage: jest.fn().mockResolvedValue(true),

    // ── Chat management ───────────────────────────────────────────────────
    getChat: jest.fn().mockResolvedValue({}),
    leaveChat: jest.fn().mockResolvedValue(true),
    pinChatMessage: jest.fn().mockResolvedValue(true),
    unpinChatMessage: jest.fn().mockResolvedValue(true),
    banChatMember: jest.fn().mockResolvedValue(true),
    unbanChatMember: jest.fn().mockResolvedValue(true),
    restrictChatMember: jest.fn().mockResolvedValue(true),
    promoteChatMember: jest.fn().mockResolvedValue(true),

    // ── Media sending ─────────────────────────────────────────────────────
    replyWithPhoto: jest.fn().mockResolvedValue({}),
    replyWithDocument: jest.fn().mockResolvedValue({}),
    replyWithAudio: jest.fn().mockResolvedValue({}),
    replyWithVideo: jest.fn().mockResolvedValue({}),
    replyWithAnimation: jest.fn().mockResolvedValue({}),
    replyWithSticker: jest.fn().mockResolvedValue({}),
    replyWithVoice: jest.fn().mockResolvedValue({}),
    replyWithLocation: jest.fn().mockResolvedValue({}),
    replyWithContact: jest.fn().mockResolvedValue({}),
    replyWithPoll: jest.fn().mockResolvedValue({}),
    replyWithDice: jest.fn().mockResolvedValue({}),
    replyWithMediaGroup: jest.fn().mockResolvedValue([]),
    replyWithInvoice: jest.fn().mockResolvedValue({}),

    // ── Merge caller-supplied extra fields ────────────────────────────────
    ...extraFields,
  };

  // The double cast (`unknown` first, then the target type) is the standard
  // Jest pattern for structural mocks: we have built the full shape the caller
  // needs without being able to satisfy every Telegraf type constraint at the
  // object-literal level.
  return ctx as unknown as jest.Mocked<Context>;
}
