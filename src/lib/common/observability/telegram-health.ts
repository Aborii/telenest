/**
 * @file src/lib/common/observability/telegram-health.ts
 *
 * PURPOSE
 * -------
 * Dependency-free health-check primitives shared by both sides of the library.
 * Each side ships a small indicator that probes connectivity and reports an
 * up/down result in a shape that is **structurally compatible with
 * `@nestjs/terminus`'s `HealthIndicatorResult`** — yet this file never imports
 * terminus. That keeps terminus a genuinely optional peer the library never
 * loads: a consumer plugs an indicator's `isHealthy()` straight into a terminus
 * `HealthCheckService`, while apps without terminus can read the same result.
 *
 * USAGE
 * -----
 * ```ts
 * // In a terminus-powered controller:
 * @Get('health')
 * @HealthCheck()
 * check() {
 *   return this.health.check([() => this.botHealth.isHealthy('telegram-bot')]);
 * }
 * ```
 *
 * KEY EXPORTS
 * -----------
 * - HEALTH_STATUSES / HealthStatus: the up/down status set.
 * - TelegramHealthIndicatorResult: the terminus-compatible result shape.
 * - runHealthCheck: builds an up/down result by running an async probe.
 * - HealthCheckError-free: failures are reported as `down`, never thrown.
 */

/**
 * The two health states, mirroring terminus' `'up'` / `'down'`. Declared as an
 * `as const` record (never an `enum`) so {@link HealthStatus} derives from it.
 */
export const HEALTH_STATUSES = {
  /** The dependency is reachable / usable. */
  UP: 'up',
  /** The dependency is unreachable or reported a failure. */
  DOWN: 'down',
} as const;

/** Union of the supported health states. */
export type HealthStatus =
  (typeof HEALTH_STATUSES)[keyof typeof HEALTH_STATUSES];

/**
 * Per-key health detail. Always carries a {@link HealthStatus}; additional
 * primitive fields (e.g. `authorized`, `error`) describe the probe result and
 * are surfaced verbatim by terminus.
 */
export type TelegramHealthDetail = {
  /** Whether this dependency is up or down. */
  status: HealthStatus;
} & Record<string, string | number | boolean | undefined>;

/**
 * A health result keyed by indicator name, matching the shape terminus expects
 * back from a health-indicator function (`{ [key]: { status, ...details } }`).
 */
export type TelegramHealthIndicatorResult = Record<
  string,
  TelegramHealthDetail
>;

/**
 * Extra detail fields a successful probe contributes to its `up` result (merged
 * alongside `status: 'up'`). Restricted to terminus-safe primitive values.
 */
export type HealthDetailExtra = Record<
  string,
  string | number | boolean | undefined
>;

/**
 * Runs an async `probe` and maps it to a terminus-compatible up/down result.
 *
 * The probe returns optional extra detail fields to merge into the `up` result.
 * Any thrown error is caught and reported as `down` with an `error` message —
 * this indicator never throws, so a failing dependency degrades the health
 * report rather than crashing the health endpoint.
 *
 * @param key - The indicator key (e.g. `telegram-bot`).
 * @param probe - Async check; resolves extra `up` detail (or `void`), or throws
 *   to signal `down`.
 * @returns A single-key {@link TelegramHealthIndicatorResult}.
 * @throws Never.
 *
 * @example
 * ```ts
 * const result = await runHealthCheck('telegram-bot', async () => {
 *   const me = await bot.getMe();
 *   return { username: me.username };
 * });
 * // -> { 'telegram-bot': { status: 'up', username: 'my_bot' } }
 * ```
 */
export async function runHealthCheck(
  key: string,
  probe: () => Promise<HealthDetailExtra | void>,
): Promise<TelegramHealthIndicatorResult> {
  try {
    const detail = await probe();
    return {
      [key]: { status: HEALTH_STATUSES.UP, ...(detail ?? {}) },
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return {
      [key]: { status: HEALTH_STATUSES.DOWN, error: message },
    };
  }
}
