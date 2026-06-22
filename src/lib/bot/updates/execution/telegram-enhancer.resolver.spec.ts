/**
 * @file src/lib/bot/updates/execution/telegram-enhancer.resolver.spec.ts
 *
 * PURPOSE
 * -------
 * Unit tests for {@link TelegramEnhancerResolver}: instance refs pass through,
 * class refs are resolved from the container, class- and method-level metadata
 * merge in the right order (guards/interceptors class-first, filters
 * method-first), `@Catch` metadata narrows a filter, and an unresolvable class
 * ref surfaces a {@link TelegramConfigError}.
 */

import {
  type CanActivate,
  Catch,
  type ExceptionFilter,
  type NestInterceptor,
  type Type,
} from '@nestjs/common';
import { type ModuleRef, Reflector } from '@nestjs/core';

import { TelegramConfigError } from '../../../common';
import {
  UseTelegramFilters,
  UseTelegramGuards,
  UseTelegramInterceptors,
} from './enhancer.decorators';
import { TelegramEnhancerResolver } from './telegram-enhancer.resolver';

/** A guard class ref resolved from the (fake) container. */
class DiGuard implements CanActivate {
  public canActivate(): boolean {
    return true;
  }
}

/** An interceptor class ref resolved from the (fake) container. */
class DiInterceptor implements NestInterceptor {
  public intercept(): never {
    throw new Error('unused');
  }
}

/** A domain error a typed filter catches. */
class DomainError extends Error {}

/** A filter narrowed to {@link DomainError} via `@Catch`. */
@Catch(DomainError)
class TypedFilter implements ExceptionFilter {
  public catch(): void {}
}

/** A filter declared catch-all via `@Catch()`. */
@Catch()
class CatchAllFilter implements ExceptionFilter {
  public catch(): void {}
}

/** A filter with no `@Catch` decorator at all (also catch-all). */
class UndecoratedFilter implements ExceptionFilter {
  public catch(): void {}
}

/** Builds a resolver over a fake container seeded with the given instances. */
function makeResolver(instances: ReadonlyMap<unknown, unknown> = new Map()): {
  resolver: TelegramEnhancerResolver;
  get: jest.Mock;
} {
  const get = jest.fn((token: unknown) => {
    if (instances.has(token)) return instances.get(token);
    throw new Error('UnknownDependenciesException');
  });
  const moduleRef = { get } as unknown as ModuleRef;
  return {
    resolver: new TelegramEnhancerResolver(moduleRef, new Reflector()),
    get,
  };
}

/** A no-op handler stand-in for classes whose enhancers are all class-level. */
const noopHandler = (): void => undefined;

describe('TelegramEnhancerResolver', () => {
  it('passes instance refs through unchanged', () => {
    const guard: CanActivate = { canActivate: () => true };

    @UseTelegramGuards(guard)
    class Demo {}

    const { resolver, get } = makeResolver();
    const resolved = resolver.resolve(Demo as Type, noopHandler);

    expect(resolved.guards).toEqual([guard]);
    expect(get).not.toHaveBeenCalled();
  });

  it('resolves class refs from the container', () => {
    const guardInstance = new DiGuard();
    const interceptorInstance = new DiInterceptor();

    @UseTelegramGuards(DiGuard)
    @UseTelegramInterceptors(DiInterceptor)
    class Demo {}

    const { resolver } = makeResolver(
      new Map<unknown, unknown>([
        [DiGuard, guardInstance],
        [DiInterceptor, interceptorInstance],
      ]),
    );
    const resolved = resolver.resolve(Demo as Type, noopHandler);

    expect(resolved.guards).toEqual([guardInstance]);
    expect(resolved.interceptors).toEqual([interceptorInstance]);
  });

  it('orders guards class-level first, then method-level', () => {
    const methodGuard: CanActivate = { canActivate: () => true };
    const classGuard = new DiGuard();

    @UseTelegramGuards(DiGuard)
    class Demo {
      @UseTelegramGuards(methodGuard)
      public handle(): void {}
    }

    const { resolver } = makeResolver(
      new Map<unknown, unknown>([[DiGuard, classGuard]]),
    );
    const resolved = resolver.resolve(Demo as Type, Demo.prototype.handle);

    expect(resolved.guards).toEqual([classGuard, methodGuard]);
  });

  it('orders filters method-level first, then class-level', () => {
    const classFilter = new CatchAllFilter();
    const methodFilter = new UndecoratedFilter();

    @UseTelegramFilters(classFilter)
    class Demo {
      @UseTelegramFilters(methodFilter)
      public handle(): void {}
    }

    const { resolver } = makeResolver();
    const resolved = resolver.resolve(Demo as Type, Demo.prototype.handle);

    expect(resolved.filters.map((f) => f.instance)).toEqual([
      methodFilter,
      classFilter,
    ]);
  });

  it('reads @Catch metadata into each filter (and treats bare/absent as catch-all)', () => {
    const typed = new TypedFilter();
    const catchAll = new CatchAllFilter();
    const undecorated = new UndecoratedFilter();

    @UseTelegramFilters(typed, catchAll, undecorated)
    class Demo {}

    const { resolver } = makeResolver();
    const resolved = resolver.resolve(Demo as Type, noopHandler);

    expect(resolved.filters).toEqual([
      { instance: typed, catches: [DomainError] },
      { instance: catchAll, catches: null },
      { instance: undecorated, catches: null },
    ]);
  });

  it('throws a TelegramConfigError when a class ref is not resolvable', () => {
    @UseTelegramGuards(DiGuard)
    class Demo {}

    // ── Container has nothing registered, so DiGuard cannot be resolved. ──────
    const { resolver } = makeResolver();

    expect(() => resolver.resolve(Demo as Type, noopHandler)).toThrow(
      TelegramConfigError,
    );
    expect(() => resolver.resolve(Demo as Type, noopHandler)).toThrow(
      /DiGuard/,
    );
  });

  it('returns empty sets for a handler with no enhancers', () => {
    class Demo {
      public handle(): void {}
    }

    const { resolver } = makeResolver();
    const resolved = resolver.resolve(Demo as Type, Demo.prototype.handle);

    expect(resolved).toEqual({ guards: [], interceptors: [], filters: [] });
  });
});
