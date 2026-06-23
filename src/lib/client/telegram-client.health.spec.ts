/**
 * @file src/lib/client/telegram-client.health.spec.ts
 *
 * PURPOSE
 * -------
 * Unit tests for the MTProto health indicator. A fake `IGramClient` drives the
 * connection/authorization states so the up/down logic is verified without any
 * network: up only when connected *and* authorized; down (with booleans + an
 * error) otherwise; transport failures degrade to down rather than throwing.
 */

import { HEALTH_STATUSES } from '../common';
import { createMockGramClient } from '../testing/mock-gram-client';
import { TelegramClientHealthIndicator } from './telegram-client.health';

describe('TelegramClientHealthIndicator', () => {
  it('reports up when connected and authorized', async () => {
    const client = createMockGramClient({
      isConnected: jest.fn().mockReturnValue(true),
      isAuthorized: jest.fn().mockResolvedValue(true),
    });
    const result = await new TelegramClientHealthIndicator(client).isHealthy();

    expect(result).toEqual({
      'telegram-client': {
        status: HEALTH_STATUSES.UP,
        connected: true,
        authorized: true,
        error: undefined,
      },
    });
  });

  it('uses the supplied key', async () => {
    const client = createMockGramClient();
    const result = await new TelegramClientHealthIndicator(client).isHealthy(
      'account:personal',
    );
    expect(result['account:personal']?.status).toBe(HEALTH_STATUSES.UP);
  });

  it('reports down (not authorized) when connected but unauthorized', async () => {
    const client = createMockGramClient({
      isConnected: jest.fn().mockReturnValue(true),
      isAuthorized: jest.fn().mockResolvedValue(false),
    });
    const result = await new TelegramClientHealthIndicator(client).isHealthy();

    expect(result['telegram-client']).toEqual({
      status: HEALTH_STATUSES.DOWN,
      connected: true,
      authorized: false,
      error: 'session is not authorized',
    });
  });

  it('reports down (not connected) without probing authorization', async () => {
    const isAuthorized = jest.fn().mockResolvedValue(true);
    const client = createMockGramClient({
      isConnected: jest.fn().mockReturnValue(false),
      isAuthorized,
    });
    const result = await new TelegramClientHealthIndicator(client).isHealthy();

    expect(result['telegram-client']).toEqual({
      status: HEALTH_STATUSES.DOWN,
      connected: false,
      authorized: false,
      error: 'client is not connected',
    });
    expect(isAuthorized).not.toHaveBeenCalled();
  });

  it('degrades to down when the authorization probe throws', async () => {
    const client = createMockGramClient({
      isConnected: jest.fn().mockReturnValue(true),
      isAuthorized: jest.fn().mockRejectedValue(new Error('transport gone')),
    });
    const result = await new TelegramClientHealthIndicator(client).isHealthy();

    expect(result['telegram-client']).toEqual({
      status: HEALTH_STATUSES.DOWN,
      connected: false,
      authorized: false,
      error: 'transport gone',
    });
  });

  it('stringifies a non-Error rejection from the probe', async () => {
    const client = createMockGramClient({
      isConnected: jest.fn().mockReturnValue(true),
      isAuthorized: jest.fn().mockRejectedValue('frozen'),
    });
    const result = await new TelegramClientHealthIndicator(client).isHealthy();

    expect(result['telegram-client']?.error).toBe('frozen');
  });
});
