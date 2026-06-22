/**
 * @file src/lib/bot/updates/execution/enhancer.decorators.spec.ts
 *
 * PURPOSE
 * -------
 * Unit tests for the `@UseTelegram*` decorators: they record their refs as
 * reflect-metadata on the class (class-level) or the method function
 * (method-level), and stacking multiple decorators appends rather than replaces.
 */

import 'reflect-metadata';

import {
  UseTelegramFilters,
  UseTelegramGuards,
  UseTelegramInterceptors,
} from './enhancer.decorators';
import {
  TELEGRAM_FILTERS_METADATA,
  TELEGRAM_GUARDS_METADATA,
  TELEGRAM_INTERCEPTORS_METADATA,
} from './enhancer.types';

/** A guard instance used as a ref. */
const guardA = { canActivate: (): boolean => true };
/** Another guard instance used as a ref. */
const guardB = { canActivate: (): boolean => false };
/** An interceptor class used as a ref. */
class InterceptorClass {
  public intercept(): never {
    throw new Error('unused');
  }
}
/** A filter instance used as a ref. */
const filterInstance = { catch: (): void => undefined };

describe('enhancer decorators', () => {
  describe('class-level metadata', () => {
    it('records guard refs on the constructor', () => {
      @UseTelegramGuards(guardA, guardB)
      class Target {}

      expect(Reflect.getMetadata(TELEGRAM_GUARDS_METADATA, Target)).toEqual([
        guardA,
        guardB,
      ]);
    });

    it('records interceptor and filter refs on the constructor', () => {
      @UseTelegramInterceptors(InterceptorClass)
      @UseTelegramFilters(filterInstance)
      class Target {}

      expect(
        Reflect.getMetadata(TELEGRAM_INTERCEPTORS_METADATA, Target),
      ).toEqual([InterceptorClass]);
      expect(Reflect.getMetadata(TELEGRAM_FILTERS_METADATA, Target)).toEqual([
        filterInstance,
      ]);
    });
  });

  describe('method-level metadata', () => {
    it('records refs on the method function', () => {
      class Target {
        @UseTelegramGuards(guardA)
        public handle(): void {}
      }

      expect(
        Reflect.getMetadata(TELEGRAM_GUARDS_METADATA, Target.prototype.handle),
      ).toEqual([guardA]);
      // ── Nothing leaks onto the class itself. ────────────────────────────────
      expect(
        Reflect.getMetadata(TELEGRAM_GUARDS_METADATA, Target),
      ).toBeUndefined();
    });
  });

  describe('robustness', () => {
    it('is a no-op when the decorated method cannot be found on the target', () => {
      const decorate = UseTelegramGuards(guardA) as MethodDecorator;
      // ── target has no "missing" member → nothing to attach metadata to. ─────
      expect(() => decorate({}, 'missing', { value: undefined })).not.toThrow();
      expect(Reflect.getMetadata(TELEGRAM_GUARDS_METADATA, {})).toBeUndefined();
    });
  });

  describe('stacking', () => {
    it('appends refs across multiple decorators on one target', () => {
      @UseTelegramGuards(guardA)
      @UseTelegramGuards(guardB)
      class Target {}

      // ── Decorators apply bottom-up; both refs are present regardless. ───────
      const refs = Reflect.getMetadata(
        TELEGRAM_GUARDS_METADATA,
        Target,
      ) as unknown[];
      expect(refs).toHaveLength(2);
      expect(refs).toContain(guardA);
      expect(refs).toContain(guardB);
    });
  });
});
