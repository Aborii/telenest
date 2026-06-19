/**
 * @file src/lib/client/telegram-client.lifecycle.ts
 *
 * PURPOSE
 * -------
 * Closes the MTProto connection when the module is torn down. The client is
 * connected eagerly at bootstrap (see telegram-client.factory.ts), and GramJS
 * keeps an open socket plus keepalive/retry timers; without this disposer those
 * would leak and could keep the Node event loop alive after `app.close()`.
 *
 * `OnModuleDestroy` is used (rather than `OnApplicationShutdown`) because it
 * fires on `app.close()` even when the consumer has not called
 * `app.enableShutdownHooks()`.
 *
 * USAGE
 * -----
 * Registered automatically as a provider by `TelegramClientModule`.
 *
 * KEY EXPORTS
 * -----------
 * - TelegramClientLifecycle: Disconnects the client on module destroy.
 */

import { Inject, Injectable, Logger, type OnModuleDestroy } from '@nestjs/common';
import type { IGramClient } from './gram-client.interface';
import { TELEGRAM_GRAM_CLIENT } from './telegram-client.constants';

/**
 * Disconnects the injected {@link IGramClient} on module destruction.
 */
@Injectable()
export class TelegramClientLifecycle implements OnModuleDestroy {
  /** Logger scoped to this disposer. */
  private readonly _logger = new Logger(TelegramClientLifecycle.name);

  /**
   * @param client - The MTProto client to disconnect on shutdown.
   */
  public constructor(
    @Inject(TELEGRAM_GRAM_CLIENT) private readonly client: IGramClient,
  ) {}

  /**
   * Closes the MTProto connection. `disconnect()` is idempotent and never
   * throws, so this can run unconditionally.
   *
   * @returns Resolves once the client has been asked to disconnect.
   * @throws Never.
   */
  public async onModuleDestroy(): Promise<void> {
    await this.client.disconnect();
    this._logger.log('MTProto client disconnected.');
  }
}
