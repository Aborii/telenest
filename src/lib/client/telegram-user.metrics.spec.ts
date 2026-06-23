/**
 * @file src/lib/client/telegram-user.metrics.spec.ts
 *
 * PURPOSE
 * -------
 * Unit tests for the user-account facade's metrics wiring: `sendMessage` /
 * `sendFile` bump `messagesSent`, and an inbound event delivered through
 * `onNewMessage` bumps `messagesReceived`. A fake `IGramClient` and an in-memory
 * recorder keep it network-free; the default (no recorder) path is also covered.
 */

import { InMemoryTelegramMetrics } from '../common';
import { aGramMessage } from '../testing/dto-builders';
import { createMockGramClient } from '../testing/mock-gram-client';
import { TelegramUserService } from './telegram-user.service';

describe('TelegramUserService metrics', () => {
  it('bumps messagesSent on sendMessage', async () => {
    const metrics = new InMemoryTelegramMetrics();
    const service = new TelegramUserService(createMockGramClient(), metrics);

    await service.sendMessage('me', 'hi');

    expect(metrics.snapshot().messagesSent).toBe(1);
  });

  it('bumps messagesSent on sendFile', async () => {
    const metrics = new InMemoryTelegramMetrics();
    const service = new TelegramUserService(createMockGramClient(), metrics);

    await service.sendFile('me', { file: Buffer.from('x') });

    expect(metrics.snapshot().messagesSent).toBe(1);
  });

  it('bumps messagesReceived for each inbound message', () => {
    const metrics = new InMemoryTelegramMetrics();
    // ── Capture the handler registered with onNewMessage so we can deliver to it. ─
    let handler:
      | ((message: ReturnType<typeof aGramMessage>) => void)
      | undefined;
    const client = createMockGramClient({
      onNewMessage: jest.fn(
        (cb: (message: ReturnType<typeof aGramMessage>) => void) => {
          handler = cb;
          return () => undefined;
        },
      ),
    });
    const service = new TelegramUserService(client, metrics);

    service.onModuleInit();
    handler?.(aGramMessage());
    handler?.(aGramMessage());

    expect(metrics.snapshot().messagesReceived).toBe(2);
    service.onModuleDestroy();
  });

  it('falls back to a no-op recorder when none is supplied', async () => {
    const service = new TelegramUserService(createMockGramClient());
    await expect(service.sendMessage('me', 'hi')).resolves.toBeDefined();
  });
});
