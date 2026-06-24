/**
 * @file src/lib/bot/updates/argument-resolver.spec.ts
 *
 * PURPOSE
 * -------
 * Unit tests for the pure argument resolver: default `[ctx]` behaviour, per-kind
 * extraction from the context, sparse-index handling, and the `undefined` cases
 * (no text, no sender, non-data callback query).
 */

import type { Context } from 'telegraf';

import { resolveHandlerArguments } from './argument-resolver';
import { PARAM_KINDS, type ParamMetadata } from './telegram-update.types';

/** Builds a minimal fake context exposing only the getters the resolver reads. */
function fakeContext(partial: {
  text?: string;
  from?: { id: number };
  callbackQuery?: { data: string } | { game_short_name: string };
  inlineQuery?: { query: string; offset: string };
}): Context {
  return partial as unknown as Context;
}

describe('resolveHandlerArguments', () => {
  it('defaults to passing the raw context when no params are decorated', () => {
    const ctx = fakeContext({ text: 'hi' });
    expect(resolveHandlerArguments(ctx, [])).toEqual([ctx]);
  });

  it('injects context, message text, and sender at their indices', () => {
    const ctx = fakeContext({ text: 'hello', from: { id: 42 } });
    const params: ParamMetadata[] = [
      { index: 0, kind: PARAM_KINDS.CONTEXT },
      { index: 1, kind: PARAM_KINDS.MESSAGE_TEXT },
      { index: 2, kind: PARAM_KINDS.SENDER },
    ];
    expect(resolveHandlerArguments(ctx, params)).toEqual([
      ctx,
      'hello',
      { id: 42 },
    ]);
  });

  it('extracts callback data only from data-bearing callback queries', () => {
    const withData = fakeContext({ callbackQuery: { data: 'go' } });
    const withoutData = fakeContext({
      callbackQuery: { game_short_name: 'g' },
    });
    const params: ParamMetadata[] = [
      { index: 0, kind: PARAM_KINDS.CALLBACK_DATA },
    ];

    expect(resolveHandlerArguments(withData, params)).toEqual(['go']);
    expect(resolveHandlerArguments(withoutData, params)).toEqual([undefined]);
  });

  it('injects inline query text and offset, undefined off inline updates', () => {
    const inline = fakeContext({ inlineQuery: { query: 'wx', offset: '10' } });
    const notInline = fakeContext({ text: 'hi' });
    const params: ParamMetadata[] = [
      { index: 0, kind: PARAM_KINDS.INLINE_QUERY_TEXT },
      { index: 1, kind: PARAM_KINDS.INLINE_QUERY_OFFSET },
    ];

    expect(resolveHandlerArguments(inline, params)).toEqual(['wx', '10']);
    expect(resolveHandlerArguments(notInline, params)).toEqual([
      undefined,
      undefined,
    ]);
  });

  it('yields undefined for absent text/sender', () => {
    const ctx = fakeContext({});
    const params: ParamMetadata[] = [
      { index: 0, kind: PARAM_KINDS.MESSAGE_TEXT },
      { index: 1, kind: PARAM_KINDS.SENDER },
    ];
    expect(resolveHandlerArguments(ctx, params)).toEqual([
      undefined,
      undefined,
    ]);
  });

  it('leaves gaps undefined when indices are sparse / unordered', () => {
    const ctx = fakeContext({ text: 'x' });
    const params: ParamMetadata[] = [
      { index: 2, kind: PARAM_KINDS.MESSAGE_TEXT },
    ];
    expect(resolveHandlerArguments(ctx, params)).toEqual([
      undefined,
      undefined,
      'x',
    ]);
  });
});
