/**
 * @file src/lib/common/observability/telegram-metrics-exporter.ts
 *
 * PURPOSE
 * -------
 * Bridges the library's in-process {@link TelegramMetricsRecorder} counters to
 * external observability backends, mirroring the OpenTelemetry *tracer* bridge in
 * `telegram-tracer.ts`. Two exporters are provided:
 *
 * - {@link createOpenTelemetryMetrics} — forwards every counter increment to an
 *   OpenTelemetry `Meter` (a `Counter` instrument per counter), so Telegram
 *   metrics land in whatever OTel pipeline the app already runs.
 * - {@link toPrometheusMetrics} — renders a {@link TelegramMetricsSnapshot} as
 *   Prometheus text-exposition format for a simple `/metrics` route.
 *
 * Like the tracer bridge, this file imports **no** `@opentelemetry/api`: the OTel
 * surface is accepted structurally ({@link OtelMeterLike}), so OpenTelemetry stays
 * a genuinely optional peer dependency and these primitives stay unit-testable
 * with a tiny fake. There is zero cost when unused — the defaults remain the
 * in-memory/no-op recorders.
 *
 * USAGE
 * -----
 * ```ts
 * // OpenTelemetry: forward the bot's counters to an OTel meter.
 * import { metrics } from '@opentelemetry/api';
 * TelegramBotModule.forRoot({
 *   token,
 *   metrics: createOpenTelemetryMetrics(metrics.getMeter('telegram')),
 * });
 *
 * // Prometheus: expose the in-memory snapshot on a /metrics route.
 * @Get('metrics')
 * metricsRoute(@Inject(TELEGRAM_BOT_METRICS) m: TelegramMetrics): string {
 *   return toPrometheusMetrics(m.snapshot());
 * }
 * ```
 *
 * KEY EXPORTS
 * -----------
 * - OtelCounterLike / OtelMeterLike: minimal structural OTel metrics shapes.
 * - OpenTelemetryMetricsOptions / createOpenTelemetryMetrics: the OTel bridge.
 * - PrometheusMetricsOptions / toPrometheusMetrics: the Prometheus snapshot helper.
 * - TELEGRAM_COUNTER_DESCRIPTIONS: human-readable description per counter.
 */

import {
  TELEGRAM_COUNTER_VALUES,
  type TelegramCounter,
  type TelegramMetricsRecorder,
  type TelegramMetricsSnapshot,
} from './telegram-metrics';

/**
 * Human-readable description of each counter, used as the OTel instrument
 * description and the Prometheus `# HELP` text. Keyed by every
 * {@link TelegramCounter} so adding a counter forces a description here.
 */
export const TELEGRAM_COUNTER_DESCRIPTIONS: Readonly<
  Record<TelegramCounter, string>
> = {
  messagesSent: 'Total outbound messages/files successfully sent.',
  messagesReceived: 'Total inbound messages/events received.',
  apiErrors: 'Total Telegram API calls that failed with an error.',
  floodWaits: 'Total errors carrying a Telegram flood-wait back-off.',
};

/**
 * The minimal subset of an OpenTelemetry `Counter` the bridge touches. Declared
 * structurally so the library never imports `@opentelemetry/api`.
 */
export interface OtelCounterLike {
  /**
   * Adds `value` to the counter, optionally tagged with attributes.
   *
   * @param value - A non-negative amount to add.
   * @param attributes - Optional dimensions to tag the measurement with.
   */
  add(
    value: number,
    attributes?: Record<string, string | number | boolean>,
  ): void;
}

/**
 * The minimal subset of an OpenTelemetry `Meter` the bridge needs: the ability
 * to create a `Counter` instrument. Satisfied by `metrics.getMeter('telegram')`
 * from `@opentelemetry/api`.
 */
export interface OtelMeterLike {
  /**
   * Creates (or returns) a counter instrument with the given name.
   *
   * @param name - The instrument name.
   * @param options - Optional description / unit metadata.
   * @returns A counter the bridge adds to.
   */
  createCounter(
    name: string,
    options?: { description?: string; unit?: string },
  ): OtelCounterLike;
}

/** Tuning options for {@link createOpenTelemetryMetrics}. */
export interface OpenTelemetryMetricsOptions {
  /**
   * Prefix prepended to each counter instrument name. Defaults to `'telegram.'`,
   * yielding instruments like `telegram.messages_sent`.
   */
  prefix?: string;
  /**
   * Static attributes attached to every measurement — e.g. `{ account: 'ops' }`
   * to distinguish multiple bots/accounts forwarding to one meter.
   */
  attributes?: Record<string, string | number | boolean>;
}

/** Default prefix for OpenTelemetry counter instrument names. */
const DEFAULT_OTEL_PREFIX = 'telegram.';

/** Default prefix (namespace) for Prometheus metric names. */
const DEFAULT_PROMETHEUS_PREFIX = 'telegram_';

/**
 * Bridges an OpenTelemetry meter into a {@link TelegramMetricsRecorder}. It
 * eagerly creates one `Counter` instrument per {@link TelegramCounter} and
 * forwards each `increment` to the matching counter's `add`. Non-positive or
 * non-finite deltas are ignored, matching `InMemoryTelegramMetrics`.
 *
 * Wire the returned recorder via the `metrics` module option (or by overriding
 * the per-side metrics token) to export the library's counters through OTel.
 *
 * @param meter - An object exposing OTel's `createCounter` — e.g.
 *   `metrics.getMeter('telegram')` from `@opentelemetry/api`.
 * @param options - Optional name prefix and static attributes.
 * @returns A recorder that forwards increments to the meter.
 * @throws Never (construction is synchronous; per-add errors propagate).
 *
 * @example
 * ```ts
 * import { metrics } from '@opentelemetry/api';
 * const recorder = createOpenTelemetryMetrics(metrics.getMeter('telegram'));
 * ```
 */
export function createOpenTelemetryMetrics(
  meter: OtelMeterLike,
  options?: OpenTelemetryMetricsOptions,
): TelegramMetricsRecorder {
  const prefix = options?.prefix ?? DEFAULT_OTEL_PREFIX;
  const attributes = options?.attributes;

  // ── Pre-create one counter instrument per known counter so each increment is
  //    a cheap `add` with no per-call instrument lookup. Names are snake_cased so
  //    they read idiomatically and match the Prometheus exporter's series. ──────
  const counters = {} as Record<TelegramCounter, OtelCounterLike>;
  for (const counter of TELEGRAM_COUNTER_VALUES)
    counters[counter] = meter.createCounter(`${prefix}${toSnakeCase(counter)}`, {
      description: TELEGRAM_COUNTER_DESCRIPTIONS[counter],
    });

  return {
    increment(counter: TelegramCounter, by = 1): void {
      // ── Guard non-positive/non-finite deltas, as InMemoryTelegramMetrics does. ─
      if (!Number.isFinite(by) || by <= 0) return;
      counters[counter].add(by, attributes);
    },
  };
}

/** Tuning options for {@link toPrometheusMetrics}. */
export interface PrometheusMetricsOptions {
  /**
   * Namespace prefix for metric names. Defaults to `'telegram_'`, yielding names
   * like `telegram_messages_sent`.
   */
  prefix?: string;
  /**
   * Optional labels applied to every metric line — e.g. `{ account: 'ops' }`.
   */
  labels?: Record<string, string>;
}

/**
 * Converts a camelCase counter name into Prometheus `snake_case`.
 *
 * @param name - The counter name (e.g. `messagesSent`).
 * @returns The snake_case form (e.g. `messages_sent`).
 * @throws Never.
 */
function toSnakeCase(name: string): string {
  return name.replace(/[A-Z]/g, (char) => `_${char.toLowerCase()}`);
}

/**
 * Escapes a Prometheus label value per the exposition format: backslash,
 * double-quote, and newline are escaped.
 *
 * @param value - The raw label value.
 * @returns The escaped value (without surrounding quotes).
 * @throws Never.
 */
function escapeLabelValue(value: string): string {
  return value
    .replace(/\\/g, '\\\\')
    .replace(/"/g, '\\"')
    .replace(/\n/g, '\\n');
}

/**
 * Renders the label block (`{a="1",b="2"}`) for a metric line, or an empty
 * string when there are no labels.
 *
 * @param labels - The labels to render, if any.
 * @returns The formatted label block, or `''`.
 * @throws Never.
 */
function formatLabels(labels?: Record<string, string>): string {
  const entries = Object.entries(labels ?? {});
  if (entries.length === 0) return '';
  const inner = entries
    .map(([key, value]) => `${key}="${escapeLabelValue(value)}"`)
    .join(',');
  return `{${inner}}`;
}

/**
 * Renders a {@link TelegramMetricsSnapshot} as Prometheus text-exposition format
 * — a `# HELP`/`# TYPE`/value triple per counter — suitable for serving from a
 * `/metrics` route. Every counter is emitted (zeros included) so the series are
 * always present.
 *
 * @param snapshot - A counter snapshot (e.g. from `metrics.snapshot()`).
 * @param options - Optional name prefix and labels.
 * @returns The Prometheus exposition text, newline-terminated.
 * @throws Never.
 *
 * @example
 * ```ts
 * res.type('text/plain').send(toPrometheusMetrics(metrics.snapshot()));
 * // telegram_messages_sent 12
 * ```
 */
export function toPrometheusMetrics(
  snapshot: TelegramMetricsSnapshot,
  options?: PrometheusMetricsOptions,
): string {
  const prefix = options?.prefix ?? DEFAULT_PROMETHEUS_PREFIX;
  const labelBlock = formatLabels(options?.labels);

  const lines: string[] = [];
  for (const counter of TELEGRAM_COUNTER_VALUES) {
    const name = `${prefix}${toSnakeCase(counter)}`;
    lines.push(`# HELP ${name} ${TELEGRAM_COUNTER_DESCRIPTIONS[counter]}`);
    lines.push(`# TYPE ${name} counter`);
    lines.push(`${name}${labelBlock} ${snapshot[counter]}`);
  }
  // ── Trailing newline: Prometheus expects each line (incl. the last) to end
  //    with one. ───────────────────────────────────────────────────────────────
  return `${lines.join('\n')}\n`;
}
