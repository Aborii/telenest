/**
 * @file src/lib/common/observability/telegram-tracer.ts
 *
 * PURPOSE
 * -------
 * A dependency-free tracing seam shared by both sides of the library. The
 * instrumented code wraps each Telegram call in
 * {@link TelegramTracer.startActiveSpan}; by default that is a no-op pass-through
 * (zero overhead, zero deps). A consumer who wants OpenTelemetry spans bridges
 * their own `@opentelemetry/api` tracer through {@link createOpenTelemetryTracer}
 * and overrides the per-side tracer DI token with it.
 *
 * Crucially, this file does **not** import `@opentelemetry/api`: it accepts a
 * structurally-typed {@link OtelTracerLike}, so OpenTelemetry stays a genuinely
 * optional peer dependency the library never loads, and these primitives remain
 * unit-testable with a tiny fake.
 *
 * USAGE
 * -----
 * ```ts
 * import { trace } from '@opentelemetry/api';
 * import { TELEGRAM_BOT_TRACER, createOpenTelemetryTracer } from 'telenest';
 *
 * // Override the bot's tracer token with an OTel-backed implementation:
 * { provide: TELEGRAM_BOT_TRACER, useValue: createOpenTelemetryTracer(trace.getTracer('telegram')) }
 * ```
 *
 * KEY EXPORTS
 * -----------
 * - TelegramSpanAttributes / TelegramTracer: the tracing seam the library uses.
 * - NoopTelegramTracer / NOOP_TELEGRAM_TRACER: the default pass-through tracer.
 * - OtelTracerLike: the minimal structural shape of an OpenTelemetry tracer.
 * - createOpenTelemetryTracer: bridges an OTel tracer into a {@link TelegramTracer}.
 */

/**
 * Primitive span attributes (OpenTelemetry-compatible). Attached to a span to
 * describe the operation — e.g. the Telegram method name.
 */
export type TelegramSpanAttributes = Record<
  string,
  string | number | boolean | undefined
>;

/**
 * The tracing seam the library records into. A single method wraps an async
 * operation in a span; the default implementation simply runs it.
 */
export interface TelegramTracer {
  /**
   * Runs `fn` inside a span named `name`, ending the span when `fn` settles.
   *
   * @typeParam T - The resolved result type of `fn`.
   * @param name - The span name (e.g. `telegram.bot.sendMessage`).
   * @param fn - The async operation to trace.
   * @param attributes - Optional attributes to record on the span.
   * @returns The resolved value of `fn`.
   * @throws Whatever `fn` throws (the span records the error, then re-throws).
   */
  startActiveSpan<T>(
    name: string,
    fn: () => Promise<T>,
    attributes?: TelegramSpanAttributes,
  ): Promise<T>;
}

/**
 * The default {@link TelegramTracer}: it runs the operation directly with no
 * span, so tracing adds nothing until a consumer opts in. Stateless and safe to
 * share via {@link NOOP_TELEGRAM_TRACER}.
 */
export class NoopTelegramTracer implements TelegramTracer {
  /** {@inheritDoc TelegramTracer.startActiveSpan} */
  public startActiveSpan<T>(_name: string, fn: () => Promise<T>): Promise<T> {
    return fn();
  }
}

/** A shared, stateless no-op tracer used as the default on every path. */
export const NOOP_TELEGRAM_TRACER: TelegramTracer = new NoopTelegramTracer();

/**
 * The minimal subset of an OpenTelemetry span the bridge touches. Declared
 * structurally so the library never imports `@opentelemetry/api`.
 */
export interface OtelSpanLike {
  /** Records the given attributes on the span (undefined values are dropped). */
  setAttributes(attributes: Record<string, string | number | boolean>): void;
  /** Records an exception event on the span. */
  recordException(exception: unknown): void;
  /** Sets the span status (code `2` = ERROR in the OTel spec). */
  setStatus(status: { code: number; message?: string }): void;
  /** Ends the span. */
  end(): void;
}

/**
 * The minimal subset of an OpenTelemetry `Tracer` the bridge needs:
 * `@opentelemetry/api`'s `startActiveSpan(name, fn)` overload, where `fn`
 * receives the active span and returns a value the tracer passes through.
 */
export interface OtelTracerLike {
  /**
   * Starts a span, makes it active for the duration of `fn`, and returns
   * whatever `fn` returns (a promise, here).
   *
   * @typeParam T - The value `fn` resolves to.
   * @param name - The span name.
   * @param fn - Callback invoked with the started span.
   * @returns The value returned by `fn`.
   */
  startActiveSpan<T>(name: string, fn: (span: OtelSpanLike) => T): T;
}

/** OpenTelemetry `SpanStatusCode.ERROR` — inlined to avoid importing the SDK. */
const OTEL_STATUS_ERROR = 2;

/**
 * Drops `undefined`-valued entries from span attributes — OpenTelemetry rejects
 * `undefined` attribute values, while our {@link TelegramSpanAttributes} allows
 * them for ergonomic call sites.
 *
 * @param attributes - The raw attributes, possibly containing `undefined`.
 * @returns A new record with only defined primitive values.
 * @throws Never.
 */
function definedAttributes(
  attributes: TelegramSpanAttributes,
): Record<string, string | number | boolean> {
  const defined: Record<string, string | number | boolean> = {};
  for (const [key, value] of Object.entries(attributes))
    if (value !== undefined) defined[key] = value;
  return defined;
}

/**
 * Bridges an OpenTelemetry tracer into the library's {@link TelegramTracer}. The
 * returned tracer opens an active span per operation, records the attributes,
 * marks the span as errored (and records the exception) when `fn` rejects, and
 * always ends the span.
 *
 * @param tracer - An object exposing OTel's `startActiveSpan(name, fn)` — e.g.
 *   `trace.getTracer('telegram')` from `@opentelemetry/api`.
 * @returns A {@link TelegramTracer} that emits real spans.
 * @throws Never (construction is synchronous; per-span errors propagate from
 *   `startActiveSpan`).
 *
 * @example
 * ```ts
 * import { trace } from '@opentelemetry/api';
 * const tracer = createOpenTelemetryTracer(trace.getTracer('telegram'));
 * ```
 */
export function createOpenTelemetryTracer(
  tracer: OtelTracerLike,
): TelegramTracer {
  return {
    startActiveSpan<T>(
      name: string,
      fn: () => Promise<T>,
      attributes?: TelegramSpanAttributes,
    ): Promise<T> {
      return tracer.startActiveSpan(name, async (span) => {
        if (attributes) span.setAttributes(definedAttributes(attributes));
        try {
          const result = await fn();
          return result;
        } catch (error) {
          // ── Mark the span errored and attach the cause before re-throwing so
          //    the failure is visible in traces but still surfaces to the caller. ─
          span.recordException(error);
          const message =
            error instanceof Error ? error.message : String(error);
          span.setStatus({ code: OTEL_STATUS_ERROR, message });
          throw error;
        } finally {
          span.end();
        }
      });
    },
  };
}
