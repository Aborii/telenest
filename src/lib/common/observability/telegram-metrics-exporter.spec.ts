/**
 * @file src/lib/common/observability/telegram-metrics-exporter.spec.ts
 *
 * PURPOSE
 * -------
 * Unit tests for the metrics exporters: the OpenTelemetry bridge (forwarding
 * counter increments to a fake `Meter`) and the Prometheus snapshot renderer.
 * A tiny fake stands in for `@opentelemetry/api`, so OTel is never imported and
 * no network is touched.
 */

import { InMemoryTelegramMetrics, TELEGRAM_COUNTERS } from './telegram-metrics';
import {
  createOpenTelemetryMetrics,
  TELEGRAM_COUNTER_DESCRIPTIONS,
  toPrometheusMetrics,
  type OtelCounterLike,
  type OtelMeterLike,
} from './telegram-metrics-exporter';

/** A fake OTel counter recording every `add` call. */
interface FakeCounter extends OtelCounterLike {
  adds: Array<{ value: number; attributes?: Record<string, unknown> }>;
}

/** Builds a fake OTel meter that hands out recording counters per name. */
function createFakeMeter(): {
  meter: OtelMeterLike;
  counters: Map<string, FakeCounter>;
  descriptions: Map<string, string | undefined>;
} {
  const counters = new Map<string, FakeCounter>();
  const descriptions = new Map<string, string | undefined>();
  const meter: OtelMeterLike = {
    createCounter(name, options) {
      const counter: FakeCounter = {
        adds: [],
        add(value, attributes) {
          counter.adds.push({ value, attributes });
        },
      };
      counters.set(name, counter);
      descriptions.set(name, options?.description);
      return counter;
    },
  };
  return { meter, counters, descriptions };
}

describe('createOpenTelemetryMetrics', () => {
  it('creates one prefixed counter per known counter with descriptions', () => {
    const { meter, counters, descriptions } = createFakeMeter();
    createOpenTelemetryMetrics(meter);

    expect([...counters.keys()].sort()).toEqual(
      [
        'telegram.api_errors',
        'telegram.flood_waits',
        'telegram.messages_received',
        'telegram.messages_sent',
      ].sort(),
    );
    expect(descriptions.get('telegram.messages_sent')).toBe(
      TELEGRAM_COUNTER_DESCRIPTIONS.messagesSent,
    );
  });

  it('forwards increments to the matching counter', () => {
    const { meter, counters } = createFakeMeter();
    const recorder = createOpenTelemetryMetrics(meter);

    recorder.increment(TELEGRAM_COUNTERS.MESSAGES_SENT);
    recorder.increment(TELEGRAM_COUNTERS.MESSAGES_SENT, 3);

    const counter = counters.get('telegram.messages_sent');
    expect(counter?.adds.map((a) => a.value)).toEqual([1, 3]);
  });

  it('ignores non-positive and non-finite deltas', () => {
    const { meter, counters } = createFakeMeter();
    const recorder = createOpenTelemetryMetrics(meter);

    recorder.increment(TELEGRAM_COUNTERS.API_ERRORS, 0);
    recorder.increment(TELEGRAM_COUNTERS.API_ERRORS, -2);
    recorder.increment(TELEGRAM_COUNTERS.API_ERRORS, Number.NaN);

    expect(counters.get('telegram.api_errors')?.adds).toHaveLength(0);
  });

  it('honors a custom prefix and static attributes', () => {
    const { meter, counters } = createFakeMeter();
    const recorder = createOpenTelemetryMetrics(meter, {
      prefix: 'tg_',
      attributes: { account: 'ops' },
    });

    recorder.increment(TELEGRAM_COUNTERS.FLOOD_WAITS);

    const counter = counters.get('tg_flood_waits');
    expect(counter?.adds[0]).toEqual({
      value: 1,
      attributes: { account: 'ops' },
    });
  });
});

describe('toPrometheusMetrics', () => {
  it('renders HELP/TYPE/value triples in snake_case with the default prefix', () => {
    const metrics = new InMemoryTelegramMetrics();
    metrics.increment(TELEGRAM_COUNTERS.MESSAGES_SENT, 5);

    const text = toPrometheusMetrics(metrics.snapshot());

    expect(text).toContain('# TYPE telegram_messages_sent counter');
    expect(text).toContain(
      `# HELP telegram_messages_sent ${TELEGRAM_COUNTER_DESCRIPTIONS.messagesSent}`,
    );
    expect(text).toContain('telegram_messages_sent 5');
    // Every counter appears, zeros included.
    expect(text).toContain('telegram_api_errors 0');
    // Ends with a trailing newline.
    expect(text.endsWith('\n')).toBe(true);
  });

  it('applies a custom prefix and labels with escaping', () => {
    const metrics = new InMemoryTelegramMetrics();
    const text = toPrometheusMetrics(metrics.snapshot(), {
      prefix: 'tg_',
      labels: { account: 'a"b\\c' },
    });

    expect(text).toContain('tg_messages_sent{account="a\\"b\\\\c"} 0');
  });
});
