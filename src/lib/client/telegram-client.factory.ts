/**
 * @file src/lib/client/telegram-client.factory.ts
 *
 * PURPOSE
 * -------
 * Pure builder for the MTProto side: resolves the initial session (options →
 * store → empty) and returns a connected {@link IGramClient}. Isolating it here
 * keeps the module declarative, gives tests a single seam (`clientFactory`), and
 * lets `TelegramClientModule` build one client per registered (named) account
 * from the same code path.
 *
 * USAGE
 * -----
 * Internal to `TelegramClientModule` (used by its per-account providers).
 *
 * KEY EXPORTS
 * -----------
 * - createConnectedGramClient: Builds + (by default) connects an account's client.
 */

import { Logger } from '@nestjs/common';
import { createGramJsClient } from './gramjs-client.adapter';
import type { IGramClient } from './gram-client.interface';
import type { TelegramClientModuleOptions } from './telegram-client.options';
import type { SessionStore } from './session/session-store.interface';

/**
 * Builds an {@link IGramClient} for one account and, unless `autoConnect` is
 * `false`, connects it. The initial session is resolved with this precedence:
 *   1. `options.session`
 *   2. `sessionStore.load()`
 *   3. empty string (fresh login required)
 *
 * @param options - Validated module options for this account.
 * @param store - The account's session store, if any.
 * @returns The (possibly connected) client.
 * @throws Never (a failed eager connect is logged, not thrown, so it never
 *   crashes bootstrap of unrelated modules).
 */
export async function createConnectedGramClient(
  options: TelegramClientModuleOptions,
  store?: SessionStore,
): Promise<IGramClient> {
  const logger = new Logger('TelegramClientFactory');

  const initialSession =
    options.session ?? (store ? await store.load() : undefined) ?? '';

  const client: IGramClient = options.clientFactory
    ? options.clientFactory(options, initialSession)
    : createGramJsClient(options, initialSession);

  // ── Connect eagerly unless explicitly disabled. Failure to connect should
  //    not crash bootstrap of unrelated modules, so it is logged. ────────────
  if (options.autoConnect !== false) {
    try {
      await client.connect();
      logger.log('MTProto client connected.');
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      logger.error(`MTProto client failed to connect: ${message}`);
    }
  }

  return client;
}
