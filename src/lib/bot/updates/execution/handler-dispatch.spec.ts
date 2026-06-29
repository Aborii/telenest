/**
 * @file src/lib/bot/updates/execution/handler-dispatch.spec.ts
 *
 * PURPOSE
 * -------
 * Unit tests for the shared handler dispatcher used by both the update and scene
 * registrars. They prove the fast path (no enhancers), error isolation on both
 * the fast and enhancer paths (including non-`Error` throws), and that a guard
 * denial is logged without running the handler. Pure: a fake context, a real
 * `Logger` (spied), and hand-built enhancer sets — no bot, no network.
 */

import { Logger } from '@nestjs/common';
import type { Context } from 'telegraf';

import type { ResolvedEnhancers } from './enhancer.types';
import { dispatchToHandler, type DispatchTarget } from './handler-dispatch';

/** A dummy provider class for the execution context's `getClass`. */
class DummyProvider {}

/** An empty enhancer set (triggers the fast path). */
const NO_ENHANCERS: ResolvedEnhancers = {
  guards: [],
  interceptors: [],
  filters: [],
};

/** Builds a dispatch target around a handler with the given enhancers. */
function target(
  handler: (...args: readonly unknown[]) => unknown,
  enhancers: ResolvedEnhancers = NO_ENHANCERS,
): DispatchTarget {
  return {
    instance: {},
    metatype: DummyProvider,
    handler,
    params: [],
    enhancers,
    label: 'Demo.handler',
  };
}

/** A minimal fake context. */
const ctx = {} as unknown as Context;

describe('dispatchToHandler', () => {
  let errorSpy: jest.SpyInstance;
  let debugSpy: jest.SpyInstance;
  let logger: Logger;

  beforeEach(() => {
    errorSpy = jest
      .spyOn(Logger.prototype, 'error')
      .mockImplementation(() => undefined);
    debugSpy = jest
      .spyOn(Logger.prototype, 'debug')
      .mockImplementation(() => undefined);
    logger = new Logger('test');
  });

  afterEach(() => jest.restoreAllMocks());

  it('runs the handler on the fast path (no enhancers)', async () => {
    const handler = jest.fn();
    await dispatchToHandler(target(handler), ctx, logger);

    expect(handler).toHaveBeenCalledWith(ctx);
    expect(errorSpy).not.toHaveBeenCalled();
  });

  it('isolates and logs a throwing handler on the fast path', async () => {
    await dispatchToHandler(
      target(() => {
        throw new Error('boom');
      }),
      ctx,
      logger,
    );

    expect(errorSpy).toHaveBeenCalledWith(
      expect.stringContaining('Demo.handler threw: boom'),
    );
  });

  it('stringifies a non-Error thrown value', async () => {
    await dispatchToHandler(
      target(() => {
        throw 'plain string';
      }),
      ctx,
      logger,
    );

    expect(errorSpy).toHaveBeenCalledWith(
      expect.stringContaining('threw: plain string'),
    );
  });

  it('logs a guard denial at debug level and does not run the handler', async () => {
    const handler = jest.fn();
    const enhancers: ResolvedEnhancers = {
      guards: [{ canActivate: () => false }],
      interceptors: [],
      filters: [],
    };

    await dispatchToHandler(target(handler, enhancers), ctx, logger);

    expect(handler).not.toHaveBeenCalled();
    expect(debugSpy).toHaveBeenCalledWith(
      expect.stringContaining('was blocked by a guard'),
    );
  });

  it('runs the handler through the enhancer path when a guard allows', async () => {
    const handler = jest.fn();
    const enhancers: ResolvedEnhancers = {
      guards: [{ canActivate: () => true }],
      interceptors: [],
      filters: [],
    };

    await dispatchToHandler(target(handler, enhancers), ctx, logger);

    expect(handler).toHaveBeenCalledWith(ctx);
    expect(errorSpy).not.toHaveBeenCalled();
    expect(debugSpy).not.toHaveBeenCalled();
  });

  it('isolates an error on the enhancer path when no filter matches', async () => {
    const enhancers: ResolvedEnhancers = {
      guards: [{ canActivate: () => true }],
      interceptors: [],
      filters: [],
    };

    await dispatchToHandler(
      target(() => {
        throw new Error('inner');
      }, enhancers),
      ctx,
      logger,
    );

    expect(errorSpy).toHaveBeenCalledWith(
      expect.stringContaining('Demo.handler threw: inner'),
    );
  });

  it('stringifies a non-Error thrown on the enhancer path', async () => {
    const enhancers: ResolvedEnhancers = {
      guards: [{ canActivate: () => true }],
      interceptors: [],
      filters: [],
    };

    await dispatchToHandler(
      target(() => {
        throw 42;
      }, enhancers),
      ctx,
      logger,
    );

    expect(errorSpy).toHaveBeenCalledWith(expect.stringContaining('threw: 42'));
  });
});
