/**
 * @file src/lib/testing/testing-module.helper.ts
 *
 * PURPOSE
 * -------
 * Provides a NestJS `TestingModule`-compatible provider override that swaps the
 * real MTProto client (`TELEGRAM_GRAM_CLIENT`) for a mock. This removes the
 * need to manually construct a `TelegramClientModule.forRoot({ clientFactory })`
 * in every test that just needs a single service from the module.
 *
 * The helper is framework-agnostic at the type level — it returns a plain
 * `FactoryProvider` object that {@link @nestjs/testing#TestingModule.overrideProvider}
 * or a `providers` array can consume directly.
 *
 * USAGE
 * -----
 * ```ts
 * import { Test } from '@nestjs/testing';
 * import { withMockGramClient } from 'nestjs-telegram/testing';
 *
 * const client = createMockGramClient();
 * const moduleRef = await Test.createTestingModule({
 *   providers: [TelegramUserService, withMockGramClient(client)],
 * }).compile();
 * ```
 *
 * KEY EXPORTS
 * -----------
 * - withMockGramClient: Returns a provider override for `TELEGRAM_GRAM_CLIENT`.
 */

import type { FactoryProvider } from '@nestjs/common';
import type { IGramClient } from '../client/gram-client.interface';
import { TELEGRAM_GRAM_CLIENT } from '../client/telegram-client.constants';

/**
 * Builds a NestJS `FactoryProvider` that registers `mockClient` under the
 * `TELEGRAM_GRAM_CLIENT` injection token. Drop this into a `providers` array
 * (or pass it to `.overrideProvider().useFactory(...)`) to replace the real
 * GramJS-backed client in a `TestingModule`.
 *
 * @param mockClient - The mock (or any {@link IGramClient} implementation) to
 *   register under the token.  Typically the return value of
 *   {@link createMockGramClient}.
 * @returns A `FactoryProvider` whose `provide` is `TELEGRAM_GRAM_CLIENT` and
 *   whose `useFactory` simply returns `mockClient`.
 * @throws Never.
 *
 * @example
 * ```ts
 * const client = createMockGramClient();
 *
 * const moduleRef = await Test.createTestingModule({
 *   imports: [TelegramClientModule.forRoot({ apiId: 1, apiHash: 'h', autoConnect: false })],
 * })
 *   .overrideProvider(TELEGRAM_GRAM_CLIENT)
 *   .useFactory({ factory: () => client })
 *   .compile();
 *
 * // — or, more concisely, using providers array —
 * const moduleRef = await Test.createTestingModule({
 *   providers: [TelegramUserService, withMockGramClient(client)],
 * }).compile();
 * ```
 */
export function withMockGramClient(mockClient: IGramClient): FactoryProvider<IGramClient> {
  return {
    provide: TELEGRAM_GRAM_CLIENT,
    useFactory: (): IGramClient => mockClient,
  };
}
