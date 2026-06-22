/**
 * @file src/lib/bot/updates/execution/telegram-execution-context.spec.ts
 *
 * PURPOSE
 * -------
 * Unit tests for {@link TelegramExecutionContext}: it exposes the update
 * `Context`, the provider class, and the handler; reports the `'telegram'` type;
 * refuses the HTTP/RPC/WS accessors; and re-wraps arbitrary hosts via `create`.
 */

import type { ArgumentsHost, ExecutionContext, Type } from '@nestjs/common';
import type { Context } from 'telegraf';
import {
  TELEGRAM_CONTEXT_TYPE,
  TelegramExecutionContext,
} from './telegram-execution-context';

/** A stand-in provider class for the context under test. */
class DemoHost {}

/** Builds a minimal Telegraf context for assertions. */
function fakeContext(partial: Record<string, unknown> = {}): Context {
  return partial as unknown as Context;
}

describe('TelegramExecutionContext', () => {
  const ctx = fakeContext({ chat: { id: 99 } });
  const handler = (): string => 'handled';
  const context = new TelegramExecutionContext(
    ctx,
    DemoHost as Type,
    handler,
  );

  it('exposes the update context, class, handler, and type', () => {
    expect(context.getContext()).toBe(ctx);
    expect(context.getClass()).toBe(DemoHost);
    expect(context.getHandler()).toBe(handler);
    expect(context.getType()).toBe(TELEGRAM_CONTEXT_TYPE);
    expect(context.getType()).toBe('telegram');
  });

  it('treats the context as the sole handler argument', () => {
    expect(context.getArgs()).toEqual([ctx]);
    expect(context.getArgByIndex(0)).toBe(ctx);
    expect(context.getArgByIndex(1)).toBeUndefined();
  });

  it('throws for the HTTP/RPC/WS hosts (no such thing for an update)', () => {
    expect(() => context.switchToHttp()).toThrow(/HTTP/);
    expect(() => context.switchToRpc()).toThrow(/RPC/);
    expect(() => context.switchToWs()).toThrow(/WS/);
  });

  describe('create()', () => {
    it('returns the same instance when given a TelegramExecutionContext', () => {
      expect(TelegramExecutionContext.create(context)).toBe(context);
    });

    it('rebuilds from a full ExecutionContext, preserving class and handler', () => {
      const otherCtx = fakeContext({ from: { id: 7 } });
      const host: ExecutionContext = {
        getArgByIndex: <T>(index: number): T =>
          (index === 0 ? otherCtx : undefined) as T,
        getArgs: <T>(): T => [otherCtx] as unknown as T,
        getClass: <T>(): Type<T> => DemoHost as Type<T>,
        getHandler: () => handler,
        getType: <T extends string>(): T => 'http' as T,
        switchToHttp: () => {
          throw new Error('unused');
        },
        switchToRpc: () => {
          throw new Error('unused');
        },
        switchToWs: () => {
          throw new Error('unused');
        },
      };

      const rewrapped = TelegramExecutionContext.create(host);
      expect(rewrapped).not.toBe(context);
      expect(rewrapped.getContext()).toBe(otherCtx);
      expect(rewrapped.getClass()).toBe(DemoHost);
      expect(rewrapped.getHandler()).toBe(handler);
    });

    it('falls back to placeholders when a bare ArgumentsHost omits class/handler', () => {
      const bareCtx = fakeContext({ text: 'hi' });
      const host: ArgumentsHost = {
        getArgByIndex: <T>(index: number): T =>
          (index === 0 ? bareCtx : undefined) as T,
        getArgs: <T>(): T => [bareCtx] as unknown as T,
        getType: <T extends string>(): T => 'rpc' as T,
        switchToHttp: () => {
          throw new Error('unused');
        },
        switchToRpc: () => {
          throw new Error('unused');
        },
        switchToWs: () => {
          throw new Error('unused');
        },
      };

      const rewrapped = TelegramExecutionContext.create(host);
      expect(rewrapped.getContext()).toBe(bareCtx);
      // ── Placeholders are still valid: a class and a callable handler. ───────
      expect(typeof rewrapped.getClass()).toBe('function');
      expect(typeof rewrapped.getHandler()).toBe('function');
      expect(() => rewrapped.getHandler()()).not.toThrow();
    });
  });
});
