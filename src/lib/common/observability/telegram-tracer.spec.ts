/**
 * @file src/lib/common/observability/telegram-tracer.spec.ts
 *
 * PURPOSE
 * -------
 * Unit tests for the tracing seam: the no-op tracer's pass-through behaviour and
 * the OpenTelemetry bridge's span lifecycle (attributes, success, error
 * recording, and always-end). A tiny fake stands in for an `@opentelemetry/api`
 * tracer, so OTel is never imported and no network is touched.
 */

import {
  createOpenTelemetryTracer,
  NOOP_TELEGRAM_TRACER,
  NoopTelegramTracer,
  type OtelSpanLike,
  type OtelTracerLike,
} from './telegram-tracer';

describe('NoopTelegramTracer', () => {
  it('runs the operation and returns its value without a span', async () => {
    const tracer = new NoopTelegramTracer();
    await expect(tracer.startActiveSpan('x', async () => 42)).resolves.toBe(42);
  });

  it('propagates the operation error untouched', async () => {
    const boom = new Error('boom');
    await expect(
      NOOP_TELEGRAM_TRACER.startActiveSpan('x', async () => {
        throw boom;
      }),
    ).rejects.toBe(boom);
  });
});

/** Builds a fake OTel span + tracer that records what the bridge does to it. */
function createFakeOtel(): {
  tracer: OtelTracerLike;
  span: jest.Mocked<OtelSpanLike>;
  spanNames: string[];
} {
  const span: jest.Mocked<OtelSpanLike> = {
    setAttributes: jest.fn(),
    recordException: jest.fn(),
    setStatus: jest.fn(),
    end: jest.fn(),
  };
  const spanNames: string[] = [];
  const tracer: OtelTracerLike = {
    startActiveSpan<T>(name: string, fn: (s: OtelSpanLike) => T): T {
      spanNames.push(name);
      return fn(span);
    },
  };
  return { tracer, span, spanNames };
}

describe('createOpenTelemetryTracer', () => {
  it('opens a named span, runs the op, and ends the span on success', async () => {
    const { tracer, span, spanNames } = createFakeOtel();
    const traced = createOpenTelemetryTracer(tracer);

    const result = await traced.startActiveSpan(
      'telegram.bot.sendMessage',
      async () => 'ok',
    );

    expect(result).toBe('ok');
    expect(spanNames).toEqual(['telegram.bot.sendMessage']);
    expect(span.end).toHaveBeenCalledTimes(1);
    expect(span.setStatus).not.toHaveBeenCalled();
    expect(span.recordException).not.toHaveBeenCalled();
  });

  it('records defined attributes and drops undefined ones', async () => {
    const { tracer, span } = createFakeOtel();
    const traced = createOpenTelemetryTracer(tracer);

    await traced.startActiveSpan('s', async () => undefined, {
      'telegram.bot.method': 'getMe',
      missing: undefined,
    });

    expect(span.setAttributes).toHaveBeenCalledWith({
      'telegram.bot.method': 'getMe',
    });
  });

  it('records the exception, marks the span errored, ends it, and rethrows', async () => {
    const { tracer, span } = createFakeOtel();
    const traced = createOpenTelemetryTracer(tracer);
    const boom = new Error('nope');

    await expect(
      traced.startActiveSpan('s', async () => {
        throw boom;
      }),
    ).rejects.toBe(boom);

    expect(span.recordException).toHaveBeenCalledWith(boom);
    expect(span.setStatus).toHaveBeenCalledWith({ code: 2, message: 'nope' });
    expect(span.end).toHaveBeenCalledTimes(1);
  });

  it('stringifies a non-Error thrown value for the span status', async () => {
    const { tracer, span } = createFakeOtel();
    const traced = createOpenTelemetryTracer(tracer);

    await expect(
      traced.startActiveSpan('s', async () => {
        throw 'plain';
      }),
    ).rejects.toBe('plain');

    expect(span.setStatus).toHaveBeenCalledWith({ code: 2, message: 'plain' });
  });
});
