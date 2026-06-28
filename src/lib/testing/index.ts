/**
 * @file src/lib/testing/index.ts
 *
 * PURPOSE
 * -------
 * Public barrel for the framework-agnostic testing utilities, published under
 * the `telenest/testing` subpath. These helpers let consumers test code
 * that depends on this library without hand-rolling fakes or ever touching the
 * Telegram network, leveraging the seams the library is already built around
 * (the `IGramClient` interface and the `TELEGRAM_GRAM_CLIENT` token on the
 * MTProto side; the Telegraf `Context` on the Bot side).
 *
 * Importing this barrel pulls in no Telegram SDK and no test runner: the
 * Telegraf type is referenced type-only and `jest.fn()` is read from the ambient
 * global a Jest runtime provides. The DTO builders are usable from any runtime.
 *
 * USAGE
 * -----
 * import {
 *   createMockGramClient,
 *   provideMockGramClient,
 *   createMockBotContext,
 *   aGramUser,
 * } from 'telenest/testing';
 *
 * KEY EXPORTS
 * -----------
 * - createMockGramClient / provideMockGramClient: MTProto client test seam.
 * - createMockBotContext: Bot API context test seam.
 * - aGramUser / aGramMessage / aGramDialog: DTO fixture builders.
 */

export * from './dto-builders';
export * from './mock-bot-context';
export * from './mock-gram-client';
