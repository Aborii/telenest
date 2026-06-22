/**
 * @file src/lib/bot/updates/execution/telegram-enhancer.resolver.ts
 *
 * PURPOSE
 * -------
 * Turns the guard / interceptor / exception-filter *refs* a handler declares via
 * the `@UseTelegram*` decorators into ready-to-run instances. A ref is either a
 * constructed instance (used as-is) or a class (resolved from the Nest DI
 * container, so the enhancer gets normal constructor injection). Class-level and
 * method-level refs are merged and ordered, and each filter's `@Catch(...)`
 * metadata is read so the pipeline knows which errors it handles.
 *
 * USAGE
 * -----
 * A provider of `TelegramBotModule`, injected into the registrar. Not used
 * directly by consumers.
 *
 * KEY EXPORTS
 * -----------
 * - TelegramEnhancerResolver: resolves a handler's enhancer refs to instances.
 */

import { Injectable, type Type } from '@nestjs/common';
import { ModuleRef, Reflector } from '@nestjs/core';

import { TelegramConfigError } from '../../../common';
import type { TelegramUpdateHandler } from '../telegram-update.types';
import {
  FILTER_CATCH_EXCEPTIONS_METADATA,
  TELEGRAM_FILTERS_METADATA,
  TELEGRAM_GUARDS_METADATA,
  TELEGRAM_INTERCEPTORS_METADATA,
  type ExceptionType,
  type ResolvedEnhancers,
  type ResolvedExceptionFilter,
  type TelegramFilter,
  type TelegramFilterRef,
  type TelegramGuard,
  type TelegramGuardRef,
  type TelegramInterceptor,
  type TelegramInterceptorRef,
} from './enhancer.types';

/**
 * Resolves the enhancer refs attached to `@TelegramUpdate` handlers into the
 * concrete {@link ResolvedEnhancers} the execution pipeline consumes.
 */
@Injectable()
export class TelegramEnhancerResolver {
  /**
   * @param _moduleRef - Resolves class refs to provider instances (DI).
   * @param _reflector - Reads the `@UseTelegram*` metadata off class and method.
   */
  public constructor(
    private readonly _moduleRef: ModuleRef,
    private readonly _reflector: Reflector,
  ) {}

  /**
   * Resolves every guard, interceptor, and filter that applies to one handler.
   *
   * Guards and interceptors are ordered **class-level first** (a class-level
   * interceptor wraps method-level ones); filters are ordered **method-level
   * first** so the most specific filter wins.
   *
   * @param target - The `@TelegramUpdate` provider class the handler belongs to.
   * @param handler - The decorated handler method.
   * @returns The resolved, ordered guard/interceptor/filter sets.
   * @throws {TelegramConfigError} If a class ref cannot be resolved from the
   *   container (it is neither a registered provider nor a passed instance).
   */
  public resolve(
    target: Type,
    handler: TelegramUpdateHandler,
  ): ResolvedEnhancers {
    const guards = this._collect<TelegramGuardRef>(
      TELEGRAM_GUARDS_METADATA,
      target,
      handler,
      false,
    ).map((ref) => this._instantiate<TelegramGuard>(ref, 'guard'));

    const interceptors = this._collect<TelegramInterceptorRef>(
      TELEGRAM_INTERCEPTORS_METADATA,
      target,
      handler,
      false,
    ).map((ref) => this._instantiate<TelegramInterceptor>(ref, 'interceptor'));

    const filters = this._collect<TelegramFilterRef>(
      TELEGRAM_FILTERS_METADATA,
      target,
      handler,
      true,
    ).map((ref) =>
      this._toResolvedFilter(
        this._instantiate<TelegramFilter>(ref, 'exception filter'),
      ),
    );

    return { guards, interceptors, filters };
  }

  /**
   * Merges the class-level and method-level refs recorded under one metadata key.
   *
   * @param key - The reflect-metadata key to read.
   * @param target - The provider class (class-level metadata).
   * @param handler - The handler method (method-level metadata).
   * @param methodFirst - When `true`, method-level refs come first (filters);
   *   otherwise class-level refs come first (guards/interceptors).
   * @returns The merged, ordered refs (empty when none are declared).
   * @throws Never.
   */
  private _collect<TRef>(
    key: string,
    target: Type,
    handler: TelegramUpdateHandler,
    methodFirst: boolean,
  ): TRef[] {
    const classRefs =
      this._reflector.get<TRef[] | undefined>(key, target) ?? [];
    const methodRefs =
      this._reflector.get<TRef[] | undefined>(key, handler) ?? [];
    return methodFirst
      ? [...methodRefs, ...classRefs]
      : [...classRefs, ...methodRefs];
  }

  /**
   * Returns the instance for a ref: a class ref is resolved from the container, an
   * instance ref is returned unchanged.
   *
   * @param ref - The enhancer instance or class.
   * @param kind - Human-readable kind, used only in the error message.
   * @returns The resolved enhancer instance.
   * @throws {TelegramConfigError} If a class ref is not resolvable from the container.
   */
  private _instantiate<T extends object>(ref: T | Type<T>, kind: string): T {
    // ── A class ref is a constructor (function); an instance is an object. ────
    if (typeof ref !== 'function') return ref;

    const cls = ref as Type<T>;
    try {
      return this._moduleRef.get<T>(cls, { strict: false });
    } catch (error) {
      throw new TelegramConfigError(
        `Telegram ${kind} "${cls.name}" could not be resolved from the DI container. ` +
          'Register it as a provider, or pass a constructed instance to the @UseTelegram* decorator.',
        error,
      );
    }
  }

  /**
   * Pairs a filter instance with the exception classes it handles, read from the
   * standard `@Catch(...)` metadata. `@Catch()` with no arguments (or no `@Catch`
   * at all) yields a catch-all (`catches === null`).
   *
   * @param instance - The exception-filter instance.
   * @returns The filter paired with its handled exception classes (or `null`).
   * @throws Never.
   */
  private _toResolvedFilter(instance: TelegramFilter): ResolvedExceptionFilter {
    const declared = Reflect.getMetadata(
      FILTER_CATCH_EXCEPTIONS_METADATA,
      instance.constructor,
    ) as unknown;

    if (!Array.isArray(declared) || declared.length === 0)
      return { instance, catches: null };

    // ── Keep only constructor entries; defend against unexpected metadata. ────
    const catches = (declared as readonly unknown[]).filter(
      (entry): entry is ExceptionType => typeof entry === 'function',
    );
    return { instance, catches: catches.length > 0 ? catches : null };
  }
}
