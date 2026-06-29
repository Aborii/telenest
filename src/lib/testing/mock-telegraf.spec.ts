/**
 * @file src/lib/testing/mock-telegraf.spec.ts
 *
 * PURPOSE
 * -------
 * Unit tests for the runtime-bot test seam: the fake `Telegraf` exposes spies for
 * every method the runtime manager/registrars call, defaults `getMe` to a
 * representative bot and `launch` to a forever-pending promise, and lets callers
 * override any spy (including a single `telegram.*` method).
 */

import { asTelegraf, createMockTelegraf } from './mock-telegraf';

describe('createMockTelegraf', () => {
  it('exposes jest spies for the handler-registration surface', () => {
    const bot = createMockTelegraf();
    for (const method of [
      'start',
      'help',
      'use',
      'command',
      'hears',
      'action',
      'on',
      'inlineQuery',
      'launch',
      'stop',
      'webhookCallback',
    ] as const)
      expect(jest.isMockFunction(bot[method])).toBe(true);
  });

  it('defaults getMe to a representative bot and setMyCommands to true', async () => {
    const bot = createMockTelegraf();
    await expect(bot.telegram.getMe()).resolves.toMatchObject({
      is_bot: true,
      username: 'mock_bot',
    });
    await expect(bot.telegram.setMyCommands([])).resolves.toBe(true);
  });

  it('launch() returns a promise that stays pending (mirrors long-polling)', async () => {
    const bot = createMockTelegraf();
    let settled = false;
    void bot.launch().then(
      () => (settled = true),
      () => (settled = true),
    );
    await new Promise((resolve) => setImmediate(resolve));
    expect(settled).toBe(false);
  });

  it('shallow-merges telegram overrides, keeping the untouched defaults', async () => {
    const bot = createMockTelegraf({
      telegram: {
        getMe: jest.fn().mockRejectedValue(new Error('401')),
        setMyCommands: jest.fn().mockResolvedValue(true),
      },
    });
    await expect(bot.telegram.getMe()).rejects.toThrow('401');
    await expect(bot.telegram.setMyCommands([])).resolves.toBe(true);
  });

  it('overrides top-level spies (e.g. a rejecting launch)', async () => {
    const bot = createMockTelegraf({
      launch: jest.fn().mockRejectedValue(new Error('409')),
    });
    await expect(bot.launch()).rejects.toThrow('409');
  });

  it('webhookCallback returns a callable no-op middleware', () => {
    const bot = createMockTelegraf();
    const middleware = bot.webhookCallback('/hook') as () => unknown;
    expect(typeof middleware).toBe('function');
    expect(middleware()).toBeUndefined();
  });

  it('asTelegraf narrows the fake to the Telegraf type', () => {
    const bot = createMockTelegraf();
    // ── Same object, just retyped — identity must be preserved. ────────────────
    expect(asTelegraf(bot)).toBe(bot);
  });
});
