/**
 * @file src/lib/testing/index.ts
 *
 * PURPOSE
 * -------
 * Public barrel for the `nestjs-telegram/testing` subpath. Consumers import
 * test utilities from this single entry point rather than deep-linking into
 * internal paths.
 *
 * USAGE
 * -----
 * ```ts
 * import {
 *   aGramUser,
 *   aGramMessage,
 *   aGramDialog,
 *   createMockGramClient,
 *   createMockBotContext,
 *   withMockGramClient,
 * } from 'nestjs-telegram/testing';
 * ```
 *
 * KEY EXPORTS
 * -----------
 * - aGramUser / aGramMessage / aGramDialog: DTO builders.
 * - createMockGramClient: Factory for a jest.Mocked<IGramClient>.
 * - createMockBotContext: Factory for a spyable Telegraf Context.
 * - withMockGramClient:   NestJS provider override for TELEGRAM_GRAM_CLIENT.
 * - MockBotContextOverrides: Overrides type accepted by createMockBotContext.
 */

export { aGramDialog, aGramMessage, aGramUser } from './dto-builders';
export { createMockGramClient } from './mock-gram-client';
export {
  createMockBotContext,
  type MockBotContextOverrides,
} from './mock-bot-context';
export { withMockGramClient } from './testing-module.helper';
