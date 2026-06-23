/**
 * @file src/lib/bot/updates/execution/handler-execution.spec.ts
 *
 * PURPOSE
 * -------
 * Unit tests for the enhancer execution pipeline {@link runWithEnhancers}: guard
 * allow/deny and short-circuiting, interceptor wrapping/ordering/short-circuit,
 * exception-filter selection (catch-all and `@Catch`-typed), and the re-throw
 * behaviour when no filter handles an error.
 */

import type { CallHandler, ExecutionContext, Type } from '@nestjs/common';
import { of, tap, type Observable } from 'rxjs';
import type { Context } from 'telegraf';

import type {
  ResolvedEnhancers,
  ResolvedExceptionFilter,
  TelegramGuard,
  TelegramInterceptor,
} from './enhancer.types';
import {
  RUN_OUTCOMES,
  runWithEnhancers,
  type HandlerThunk,
} from './handler-execution';
import { TelegramExecutionContext } from './telegram-execution-context';

/** Stand-in provider class for the execution context. */
class DemoHost {}

/** Builds an execution context over a throwaway Telegraf context. */
function makeContext(): TelegramExecutionContext {
  return new TelegramExecutionContext(
    {} as Context,
    DemoHost as Type,
    () => undefined,
  );
}

/** Builds a full enhancer set from partial overrides. */
function enhancers(partial: Partial<ResolvedEnhancers>): ResolvedEnhancers {
  return {
    guards: partial.guards ?? [],
    interceptors: partial.interceptors ?? [],
    filters: partial.filters ?? [],
  };
}

/** A guard with a fixed (or computed) verdict. */
function guard(canActivate: TelegramGuard['canActivate']): TelegramGuard {
  return { canActivate };
}

describe('runWithEnhancers', () => {
  describe('without enhancers', () => {
    it('runs the handler and reports COMPLETED', async () => {
      const handler = jest.fn<ReturnType<HandlerThunk>, []>();
      const outcome = await runWithEnhancers({
        context: makeContext(),
        enhancers: enhancers({}),
        handler,
      });

      expect(handler).toHaveBeenCalledTimes(1);
      expect(outcome).toBe(RUN_OUTCOMES.COMPLETED);
    });
  });

  describe('guards', () => {
    it('runs the handler when every guard allows', async () => {
      const handler = jest.fn();
      const outcome = await runWithEnhancers({
        context: makeContext(),
        enhancers: enhancers({ guards: [guard(() => true)] }),
        handler,
      });

      expect(handler).toHaveBeenCalledTimes(1);
      expect(outcome).toBe(RUN_OUTCOMES.COMPLETED);
    });

    it('blocks the handler and reports DENIED when a guard denies', async () => {
      const handler = jest.fn();
      const outcome = await runWithEnhancers({
        context: makeContext(),
        enhancers: enhancers({ guards: [guard(() => false)] }),
        handler,
      });

      expect(handler).not.toHaveBeenCalled();
      expect(outcome).toBe(RUN_OUTCOMES.DENIED);
    });

    it('resolves promise- and observable-returning guards', async () => {
      const handler = jest.fn();
      const outcome = await runWithEnhancers({
        context: makeContext(),
        enhancers: enhancers({
          guards: [guard(() => Promise.resolve(true)), guard(() => of(true))],
        }),
        handler,
      });

      expect(handler).toHaveBeenCalledTimes(1);
      expect(outcome).toBe(RUN_OUTCOMES.COMPLETED);
    });

    it('short-circuits on the first denial (later guards do not run)', async () => {
      const handler = jest.fn();
      const second = jest.fn(() => true);
      const outcome = await runWithEnhancers({
        context: makeContext(),
        enhancers: enhancers({
          guards: [guard(() => false), guard(second)],
        }),
        handler,
      });

      expect(second).not.toHaveBeenCalled();
      expect(handler).not.toHaveBeenCalled();
      expect(outcome).toBe(RUN_OUTCOMES.DENIED);
    });
  });

  describe('interceptors', () => {
    it('wraps the handler, running pre/post around it in order', async () => {
      const order: string[] = [];
      const trace = (name: string): TelegramInterceptor => ({
        intercept: (
          _context: ExecutionContext,
          next: CallHandler,
        ): Observable<unknown> => {
          order.push(`${name}:pre`);
          return next.handle().pipe(tap(() => order.push(`${name}:post`)));
        },
      });
      const handler: HandlerThunk = () => order.push('handler');

      const outcome = await runWithEnhancers({
        context: makeContext(),
        enhancers: enhancers({
          interceptors: [trace('outer'), trace('inner')],
        }),
        handler,
      });

      expect(order).toEqual([
        'outer:pre',
        'inner:pre',
        'handler',
        'inner:post',
        'outer:post',
      ]);
      expect(outcome).toBe(RUN_OUTCOMES.COMPLETED);
    });

    it('lets an interceptor short-circuit the handler', async () => {
      const handler = jest.fn();
      const shortCircuit: TelegramInterceptor = {
        intercept: (): Observable<unknown> => of('replaced'),
      };

      const outcome = await runWithEnhancers({
        context: makeContext(),
        enhancers: enhancers({ interceptors: [shortCircuit] }),
        handler,
      });

      expect(handler).not.toHaveBeenCalled();
      expect(outcome).toBe(RUN_OUTCOMES.COMPLETED);
    });

    it('awaits an async handler before the post phase', async () => {
      const order: string[] = [];
      const interceptor: TelegramInterceptor = {
        intercept: (
          _context: ExecutionContext,
          next: CallHandler,
        ): Observable<unknown> =>
          next.handle().pipe(tap(() => order.push('post'))),
      };
      const handler: HandlerThunk = async () => {
        await Promise.resolve();
        order.push('handler');
      };

      await runWithEnhancers({
        context: makeContext(),
        enhancers: enhancers({ interceptors: [interceptor] }),
        handler,
      });

      expect(order).toEqual(['handler', 'post']);
    });
  });

  describe('exception filters', () => {
    const boom = (): never => {
      throw new TypeError('kaboom');
    };

    it('re-throws when no filter is configured', async () => {
      await expect(
        runWithEnhancers({
          context: makeContext(),
          enhancers: enhancers({}),
          handler: boom,
        }),
      ).rejects.toThrow('kaboom');
    });

    it('routes a handler error to a catch-all filter', async () => {
      const context = makeContext();
      const filterCatch = jest.fn();
      const filter: ResolvedExceptionFilter = {
        instance: { catch: filterCatch },
        catches: null,
      };

      const outcome = await runWithEnhancers({
        context,
        enhancers: enhancers({ filters: [filter] }),
        handler: boom,
      });

      expect(outcome).toBe(RUN_OUTCOMES.COMPLETED);
      expect(filterCatch).toHaveBeenCalledTimes(1);
      const [error, host] = filterCatch.mock.calls[0] ?? [];
      expect(error).toBeInstanceOf(TypeError);
      expect(host).toBe(context);
    });

    it('routes a guard error to a filter too', async () => {
      const filterCatch = jest.fn();
      const filter: ResolvedExceptionFilter = {
        instance: { catch: filterCatch },
        catches: null,
      };

      const outcome = await runWithEnhancers({
        context: makeContext(),
        enhancers: enhancers({
          guards: [
            guard(() => {
              throw new Error('guard exploded');
            }),
          ],
          filters: [filter],
        }),
        handler: jest.fn(),
      });

      expect(outcome).toBe(RUN_OUTCOMES.COMPLETED);
      expect(filterCatch).toHaveBeenCalledTimes(1);
    });

    it('only handles errors that match a @Catch-typed filter', async () => {
      const filterCatch = jest.fn();
      const filter: ResolvedExceptionFilter = {
        instance: { catch: filterCatch },
        catches: [RangeError],
      };

      // ── TypeError is not a RangeError → not handled → re-thrown. ────────────
      await expect(
        runWithEnhancers({
          context: makeContext(),
          enhancers: enhancers({ filters: [filter] }),
          handler: boom,
        }),
      ).rejects.toThrow('kaboom');
      expect(filterCatch).not.toHaveBeenCalled();
    });

    it('handles an error matching the typed filter', async () => {
      const filterCatch = jest.fn();
      const filter: ResolvedExceptionFilter = {
        instance: { catch: filterCatch },
        catches: [TypeError],
      };

      const outcome = await runWithEnhancers({
        context: makeContext(),
        enhancers: enhancers({ filters: [filter] }),
        handler: boom,
      });

      expect(outcome).toBe(RUN_OUTCOMES.COMPLETED);
      expect(filterCatch).toHaveBeenCalledTimes(1);
    });

    it('re-throws a non-object throwable that a typed filter cannot match', async () => {
      const filterCatch = jest.fn();
      const filter: ResolvedExceptionFilter = {
        instance: { catch: filterCatch },
        catches: [TypeError],
      };

      // ── A thrown string is not an instance of anything → not handled. ───────
      await expect(
        runWithEnhancers({
          context: makeContext(),
          enhancers: enhancers({ filters: [filter] }),
          handler: () => {
            throw 'just a string';
          },
        }),
      ).rejects.toBe('just a string');
      expect(filterCatch).not.toHaveBeenCalled();
    });

    it('lets a catch-all filter handle a non-Error throwable', async () => {
      const filterCatch = jest.fn();
      const filter: ResolvedExceptionFilter = {
        instance: { catch: filterCatch },
        catches: null,
      };

      const outcome = await runWithEnhancers({
        context: makeContext(),
        enhancers: enhancers({ filters: [filter] }),
        handler: () => {
          throw 'just a string';
        },
      });

      expect(outcome).toBe(RUN_OUTCOMES.COMPLETED);
      expect(filterCatch).toHaveBeenCalledWith(
        'just a string',
        expect.anything(),
      );
    });

    it('picks the first matching filter in order', async () => {
      const first = jest.fn();
      const second = jest.fn();
      const filters: ResolvedExceptionFilter[] = [
        { instance: { catch: first }, catches: [TypeError] },
        { instance: { catch: second }, catches: null },
      ];

      await runWithEnhancers({
        context: makeContext(),
        enhancers: enhancers({ filters }),
        handler: boom,
      });

      expect(first).toHaveBeenCalledTimes(1);
      expect(second).not.toHaveBeenCalled();
    });
  });
});
