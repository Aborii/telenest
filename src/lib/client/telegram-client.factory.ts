/**
 * @file src/lib/client/telegram-client.factory.ts
 *
 * PURPOSE
 * -------
 * DI providers for the MTProto side: one that exposes the configured
 * {@link SessionStore}, and one that builds the connected {@link IGramClient}.
 * Keeping construction here lets tests override `TELEGRAM_GRAM_CLIENT` (or pass
 * `clientFactory`) to avoid any network access.
 *
 * USAGE
 * -----
 * Internal to `TelegramClientModule`.
 *
 * KEY EXPORTS
 * -----------
 * - sessionStoreProvider: Provides TELEGRAM_SESSION_STORE from options.
 * - gramClientProvider: Provides the connected TELEGRAM_GRAM_CLIENT.
 */

import type { Provider } from '@nestjs/common';
import { Logger } from '@nestjs/common';

import type { IGramClient } from './gram-client.interface';
import { createGramJsClient } from './gramjs-client.adapter';
import type { SessionStore } from './session/session-store.interface';
import {
  TELEGRAM_GRAM_CLIENT,
  TELEGRAM_SESSION_STORE,
} from './telegram-client.constants';
import { TELEGRAM_CLIENT_OPTIONS } from './telegram-client.module-definition';
import type { TelegramClientModuleOptions } from './telegram-client.options';

/** Provider exposing the configured {@link SessionStore} (or `undefined`). */
export const sessionStoreProvider: Provider = {
  provide: TELEGRAM_SESSION_STORE,
  useFactory: (
    options: TelegramClientModuleOptions,
  ): SessionStore | undefined => options.sessionStore,
  inject: [TELEGRAM_CLIENT_OPTIONS],
};

/**
 * Provider that builds and (by default) connects the MTProto client.
 *
 * The initial session is resolved with this precedence:
 *   1. `options.session`
 *   2. `sessionStore.load()`
 *   3. empty string (fresh login required)
 */
export const gramClientProvider: Provider = {
  provide: TELEGRAM_GRAM_CLIENT,
  useFactory: async (
    options: TelegramClientModuleOptions,
    store?: SessionStore,
  ): Promise<IGramClient> => {
    const logger = new Logger('TelegramClientFactory');

    const initialSession =
      options.session ?? (store ? await store.load() : undefined) ?? '';

    const client: IGramClient = options.clientFactory
      ? options.clientFactory(options, initialSession)
      : createGramJsClient(options, initialSession);

    // ── Connect eagerly unless explicitly disabled. Failure to connect should
    //    not crash bootstrap of unrelated modules, so it is logged. ──────────
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
  },
  inject: [
    TELEGRAM_CLIENT_OPTIONS,
    { token: TELEGRAM_SESSION_STORE, optional: true },
  ],
};
