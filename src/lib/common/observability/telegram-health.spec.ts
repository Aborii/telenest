/**
 * @file src/lib/common/observability/telegram-health.spec.ts
 *
 * PURPOSE
 * -------
 * Unit tests for the shared health-check helper: an `up` result merges the
 * probe's extra detail, a thrown probe degrades to `down` with an error message,
 * and the helper never throws. Pure logic — no network.
 */

import { HEALTH_STATUSES, runHealthCheck } from './telegram-health';

describe('runHealthCheck', () => {
  it('reports up and merges the probe detail', async () => {
    const result = await runHealthCheck('telegram-bot', async () => ({
      username: 'my_bot',
    }));
    expect(result).toEqual({
      'telegram-bot': { status: HEALTH_STATUSES.UP, username: 'my_bot' },
    });
  });

  it('reports up with no extra detail when the probe returns void', async () => {
    const result = await runHealthCheck('svc', async () => undefined);
    expect(result).toEqual({ svc: { status: HEALTH_STATUSES.UP } });
  });

  it('reports down with the error message when the probe throws', async () => {
    const result = await runHealthCheck('svc', async () => {
      throw new Error('unreachable');
    });
    expect(result).toEqual({
      svc: { status: HEALTH_STATUSES.DOWN, error: 'unreachable' },
    });
  });

  it('stringifies a non-Error rejection', async () => {
    const result = await runHealthCheck('svc', async () => {
      throw 'boom';
    });
    expect(result).toEqual({
      svc: { status: HEALTH_STATUSES.DOWN, error: 'boom' },
    });
  });

  it('never throws — failures surface as a down result', async () => {
    await expect(
      runHealthCheck('svc', async () => {
        throw new Error('x');
      }),
    ).resolves.toBeDefined();
  });
});
