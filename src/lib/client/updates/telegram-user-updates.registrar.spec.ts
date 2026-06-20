/**
 * @file src/lib/client/updates/telegram-user-updates.registrar.spec.ts
 *
 * PURPOSE
 * -------
 * Integration test proving the end-to-end inbound-update path: a `@OnUserMessage`
 * handler on a provider is discovered, filtered, invoked with a reply context,
 * and torn down — all driven by a fake client emitting events (no network).
 *
 * Lifecycle hooks are invoked directly (rather than via a full HTTP app) so the
 * test is fast and deterministic.
 */

import { Injectable } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import type { IGramClient } from '../gram-client.interface';
import type { GramMessage } from '../gram-client.types';
import { TelegramClientModule } from '../telegram-client.module';
import { TelegramUserService } from '../telegram-user.service';
import { OnUserMessage } from './on-user-message.decorator';
import type { GramUserMessageContext } from './on-user-message.types';
import { TelegramUserUpdatesRegistrar } from './telegram-user-updates.registrar';

/** A provider whose decorated methods record what they receive. */
@Injectable()
class CapturingHandler {
  /** Messages seen by the unfiltered handler. */
  public readonly all: GramMessage[] = [];
  /** Messages seen by the incoming-only handler. */
  public readonly incoming: GramMessage[] = [];

  @OnUserMessage()
  public onAll(message: GramMessage): void {
    this.all.push(message);
  }

  @OnUserMessage({ incoming: true })
  public async onIncoming(
    message: GramMessage,
    ctx: GramUserMessageContext,
  ): Promise<void> {
    this.incoming.push(message);
    await ctx.reply('ack');
  }
}

/** A provider whose handler always throws. */
@Injectable()
class ThrowingHandler {
  /** Number of times the handler was invoked. */
  public count = 0;

  @OnUserMessage()
  public boom(): void {
    this.count += 1;
    throw new Error('handler failure');
  }
}

/** Builds a fake client whose new-message stream can be driven by the test. */
function createEmittableClient(): {
  client: IGramClient;
  sendMessage: jest.Mock;
  emit: (message: GramMessage) => void;
} {
  let handler: ((message: GramMessage) => void) | undefined;
  const sendMessage = jest.fn().mockResolvedValue({
    id: 99,
    peerId: '555',
    text: 'ack',
    date: 0,
    out: true,
  });

  const client: IGramClient = {
    connect: jest.fn().mockResolvedValue(undefined),
    disconnect: jest.fn().mockResolvedValue(undefined),
    isConnected: jest.fn().mockReturnValue(true),
    isAuthorized: jest.fn().mockResolvedValue(true),
    sendCode: jest.fn(),
    signInWithCode: jest.fn(),
    signInWithPassword: jest.fn(),
    logOut: jest.fn(),
    getMe: jest.fn(),
    getDialogs: jest.fn(),
    getMessages: jest.fn(),
    sendMessage,
    exportSession: jest.fn().mockReturnValue(''),
    onNewMessage: (h) => {
      handler = h;
      return () => {
        handler = undefined;
      };
    },
  };

  return { client, sendMessage, emit: (message) => handler?.(message) };
}

/** Flushes pending microtasks (the registrar invokes handlers asynchronously). */
const flush = (): Promise<void> =>
  new Promise((resolve) => setImmediate(resolve));

/** Compiles the module + a handler provider and starts the update pipeline. */
async function bootstrap(
  client: IGramClient,
  handlerProvider: new () => object,
): Promise<{
  userService: TelegramUserService;
  registrar: TelegramUserUpdatesRegistrar;
  handler: object;
}> {
  const moduleRef = await Test.createTestingModule({
    imports: [
      TelegramClientModule.forRoot({
        apiId: 1,
        apiHash: 'hash',
        autoConnect: false,
        clientFactory: () => client,
      }),
    ],
    providers: [handlerProvider],
  }).compile();

  const userService = moduleRef.get(TelegramUserService, { strict: false });
  const registrar = moduleRef.get(TelegramUserUpdatesRegistrar, {
    strict: false,
  });
  const handler = moduleRef.get(handlerProvider);

  // ── Run lifecycle in the same order Nest would (source before consumers). ──
  userService.onModuleInit();
  registrar.onModuleInit();

  return { userService, registrar, handler };
}

describe('TelegramUserUpdatesRegistrar (integration)', () => {
  it('dispatches filtered messages to decorated handlers and supports reply', async () => {
    const { client, sendMessage, emit } = createEmittableClient();
    const { userService, registrar, handler } = await bootstrap(
      client,
      CapturingHandler,
    );
    const captured = handler as CapturingHandler;

    // ── Incoming message: both handlers fire; the incoming one replies. ──────
    emit({ id: 1, peerId: '555', text: 'hello', date: 0, out: false });
    await flush();

    expect(captured.all).toHaveLength(1);
    expect(captured.incoming).toHaveLength(1);
    expect(sendMessage).toHaveBeenCalledWith('555', { message: 'ack' });

    // ── Outgoing message: only the unfiltered handler fires. ─────────────────
    emit({ id: 2, peerId: '555', text: 'mine', date: 0, out: true });
    await flush();

    expect(captured.all).toHaveLength(2);
    expect(captured.incoming).toHaveLength(1);

    // ── Teardown unsubscribes; emissions afterwards are ignored. ─────────────
    registrar.onModuleDestroy();
    userService.onModuleDestroy();
    emit({ id: 3, peerId: '555', text: 'late', date: 0, out: false });
    await flush();
    expect(captured.all).toHaveLength(2);
  });

  it('isolates a throwing handler so it does not break the stream', async () => {
    const { client, emit } = createEmittableClient();
    const { handler } = await bootstrap(client, ThrowingHandler);
    const throwing = handler as ThrowingHandler;

    // ── Two emissions: the first throws, the second must still be delivered. ─
    emit({ id: 1, peerId: '1', text: 'a', date: 0, out: false });
    emit({ id: 2, peerId: '1', text: 'b', date: 0, out: false });
    await flush();

    expect(throwing.count).toBe(2);
  });
});
