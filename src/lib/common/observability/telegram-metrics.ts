/**
 * @file src/lib/common/observability/telegram-metrics.ts
 *
 * PURPOSE
 * -------
 * Dependency-free metrics primitives shared by the Bot API and MTProto sides of
 * the library. They give consumers operational visibility (messages sent /
 * received, API errors, flood-waits) without coupling either side to a specific
 * metrics backend: the library records into a tiny {@link TelegramMetricsRecorder}
 * sink, and a consumer bridges the {@link TelegramMetrics.snapshot} to Prometheus
 * (or anything else) on their own schedule.
 *
 * Living under `common`, this file imports neither Telegraf nor GramJS, so the
 * same counter vocabulary and in-memory implementation serve both decoupled
 * feature modules.
 *
 * USAGE
 * -----
 * ```ts
 * import { Inject } from '@nestjs/common';
 * import { TELEGRAM_BOT_METRICS, type TelegramMetrics } from 'telenest';
 *
 * constructor(@Inject(TELEGRAM_BOT_METRICS) private readonly metrics: TelegramMetrics) {}
 *
 * report() {
 *   const { messagesSent, apiErrors } = this.metrics.snapshot();
 * }
 * ```
 *
 * KEY EXPORTS
 * -----------
 * - TELEGRAM_COUNTERS / TelegramCounter: the closed set of counter names.
 * - TelegramMetricsSnapshot: a plain `{ counter: number }` reading.
 * - TelegramMetricsRecorder: the minimal write surface the library records into.
 * - TelegramMetrics: the readable surface (recorder + snapshot/reset).
 * - InMemoryTelegramMetrics: the default in-process counter implementation.
 * - NOOP_TELEGRAM_METRICS: a shared do-nothing recorder for un-instrumented paths.
 */

/**
 * Closed set of counter names the library tracks. Declared as an `as const`
 * record (never an `enum`, per repo conventions) so the {@link TelegramCounter}
 * union and {@link TELEGRAM_COUNTER_VALUES} array can be derived from it.
 */
export const TELEGRAM_COUNTERS = {
  /** Outbound messages/files successfully sent (Bot API `send*` / user send*). */
  MESSAGES_SENT: 'messagesSent',
  /** Inbound messages received (bot updates carrying a message / account events). */
  MESSAGES_RECEIVED: 'messagesReceived',
  /** API calls that failed with an error after normalization. */
  API_ERRORS: 'apiErrors',
  /** Errors carrying a Telegram flood-wait / `retry_after` back-off. */
  FLOOD_WAITS: 'floodWaits',
} as const;

/** Union of every counter name understood by this library. */
export type TelegramCounter =
  (typeof TELEGRAM_COUNTERS)[keyof typeof TELEGRAM_COUNTERS];

/** Readonly array form of {@link TELEGRAM_COUNTERS} for iteration/initialization. */
export const TELEGRAM_COUNTER_VALUES = Object.values(
  TELEGRAM_COUNTERS,
) as readonly TelegramCounter[];

/**
 * An immutable reading of every counter at a point in time. Keyed by every
 * member of {@link TelegramCounter}, so a snapshot is always complete.
 */
export type TelegramMetricsSnapshot = Readonly<Record<TelegramCounter, number>>;

/**
 * The minimal **write** surface the library records into. Kept tiny on purpose:
 * the only thing the instrumented code paths need is to bump a counter, so a
 * custom backend can implement a single method.
 */
export interface TelegramMetricsRecorder {
  /**
   * Increments a counter.
   *
   * @param counter - The counter to bump.
   * @param by - Positive increment; defaults to `1`.
   * @returns Nothing.
   * @throws Never.
   */
  increment(counter: TelegramCounter, by?: number): void;
}

/**
 * The **readable** metrics surface: a {@link TelegramMetricsRecorder} that can
 * also be read ({@link TelegramMetrics.snapshot}) and cleared
 * ({@link TelegramMetrics.reset}). This is the type the per-side metrics DI
 * tokens resolve to, so consumers can both record and read.
 */
export interface TelegramMetrics extends TelegramMetricsRecorder {
  /**
   * @returns A complete, immutable reading of every counter.
   * @throws Never.
   */
  snapshot(): TelegramMetricsSnapshot;

  /**
   * Resets every counter back to zero.
   *
   * @returns Nothing.
   * @throws Never.
   */
  reset(): void;
}

/**
 * Builds a fresh, all-zero counter map covering every {@link TelegramCounter}.
 *
 * @returns A mutable record with every counter initialized to `0`.
 * @throws Never.
 */
function zeroedCounters(): Record<TelegramCounter, number> {
  // ── Build from the derived values array so a new counter is covered without
  //    touching this helper. ──────────────────────────────────────────────────
  const counters = {} as Record<TelegramCounter, number>;
  for (const counter of TELEGRAM_COUNTER_VALUES) counters[counter] = 0;
  return counters;
}

/**
 * The default, in-process {@link TelegramMetrics}: a set of plain numeric
 * counters held in memory. Zero dependencies and zero network — suitable as the
 * library's default sink and as a base a consumer reads from to export elsewhere.
 *
 * It is intentionally **not** a moving-window or rate meter: counters are
 * monotonic totals since construction (or the last {@link reset}). Derive rates
 * by sampling {@link snapshot} over time.
 */
export class InMemoryTelegramMetrics implements TelegramMetrics {
  /** Backing counter map; every {@link TelegramCounter} starts at zero. */
  private readonly _counters: Record<TelegramCounter, number> =
    zeroedCounters();

  /** {@inheritDoc TelegramMetricsRecorder.increment} */
  public increment(counter: TelegramCounter, by = 1): void {
    // ── Guard against negative / non-finite deltas silently corrupting totals;
    //    a non-positive increment is a caller bug, so it is simply ignored. ────
    if (!Number.isFinite(by) || by <= 0) return;
    this._counters[counter] += by;
  }

  /** {@inheritDoc TelegramMetrics.snapshot} */
  public snapshot(): TelegramMetricsSnapshot {
    // ── Return a copy so callers cannot mutate the live counters. ─────────────
    return { ...this._counters };
  }

  /** {@inheritDoc TelegramMetrics.reset} */
  public reset(): void {
    for (const counter of TELEGRAM_COUNTER_VALUES) this._counters[counter] = 0;
  }
}

/**
 * A shared, do-nothing {@link TelegramMetricsRecorder}. Instrumented code paths
 * fall back to this when no recorder was injected (e.g. a service constructed
 * directly in a unit test), so they never have to null-check the sink.
 */
export const NOOP_TELEGRAM_METRICS: TelegramMetricsRecorder = {
  increment(): void {
    // ── Intentionally empty: metrics are disabled on this path. ───────────────
  },
};
