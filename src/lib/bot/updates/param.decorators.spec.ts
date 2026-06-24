/**
 * @file src/lib/bot/updates/param.decorators.spec.ts
 *
 * PURPOSE
 * -------
 * Verifies the parameter decorators record one {@link ParamMetadata} per slot,
 * with the right kind and index, accumulating across multiple parameters on a
 * single method.
 */

import 'reflect-metadata';

import {
  CallbackData,
  Ctx,
  InlineQueryOffset,
  InlineQueryText,
  MessageText,
  Sender,
} from './param.decorators';
import {
  PARAM_KINDS,
  UPDATE_PARAMS_METADATA,
  type ParamMetadata,
} from './telegram-update.types';

/** Reads the param-metadata array stored on a prototype method. */
function paramsOf(prototype: object, method: string): ParamMetadata[] {
  const fn = (prototype as Record<string, unknown>)[method] as object;
  return (
    (Reflect.getMetadata(UPDATE_PARAMS_METADATA, fn) as ParamMetadata[]) ?? []
  );
}

describe('parameter decorators', () => {
  class Handlers {
    single(@Ctx() _ctx: unknown): void {}

    multi(
      @Sender() _from: unknown,
      @MessageText() _text: unknown,
      @CallbackData() _data: unknown,
    ): void {}

    inline(
      @InlineQueryText() _text: unknown,
      @InlineQueryOffset() _offset: unknown,
    ): void {}
  }

  const proto = Handlers.prototype;

  it('records a single @Ctx() at index 0', () => {
    expect(paramsOf(proto, 'single')).toEqual([
      { index: 0, kind: PARAM_KINDS.CONTEXT },
    ]);
  });

  it('records each parameter with its kind and index', () => {
    // ── Parameter decorators evaluate right-to-left; sort by index to assert. ─
    const sorted = [...paramsOf(proto, 'multi')].sort(
      (a, b) => a.index - b.index,
    );
    expect(sorted).toEqual([
      { index: 0, kind: PARAM_KINDS.SENDER },
      { index: 1, kind: PARAM_KINDS.MESSAGE_TEXT },
      { index: 2, kind: PARAM_KINDS.CALLBACK_DATA },
    ]);
  });

  it('records the inline-query parameter kinds', () => {
    const sorted = [...paramsOf(proto, 'inline')].sort(
      (a, b) => a.index - b.index,
    );
    expect(sorted).toEqual([
      { index: 0, kind: PARAM_KINDS.INLINE_QUERY_TEXT },
      { index: 1, kind: PARAM_KINDS.INLINE_QUERY_OFFSET },
    ]);
  });
});
