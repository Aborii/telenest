/**
 * @file src/lib/client/telegram-client.module.ts
 *
 * PURPOSE
 * -------
 * Dynamic Nest module for the MTProto (user account) side. Each `forRoot` /
 * `forRootAsync` call registers **one** account: it builds and connects that
 * account's {@link IGramClient}, wires its {@link SessionStore}, and exposes the
 * account's {@link TelegramAuthService} and {@link TelegramUserService} (plus an
 * internal lifecycle disposer and `@OnUserMessage` registrar).
 *
 * Call it more than once with distinct `name`s to drive **multiple user accounts**
 * in one application. Every per-account provider is registered under a
 * name-derived token (see `./telegram-client.tokens`), and each registration is an
 * isolated Nest module instance with its own options/session — so two accounts
 * never collide on tokens or sessions. The default (unnamed) account keeps its
 * legacy tokens (`TELEGRAM_GRAM_CLIENT`, `TELEGRAM_SESSION_STORE`, the
 * `TelegramAuthService` / `TelegramUserService` classes) for backward compatibility.
 *
 * USAGE
 * -----
 * ```ts
 * // Single (default) account — unchanged.
 * TelegramClientModule.forRootAsync({
 *   inject: [ConfigService],
 *   useFactory: (c: ConfigService) => ({
 *     apiId: Number(c.getOrThrow('TG_API_ID')),
 *     apiHash: c.getOrThrow('TG_API_HASH'),
 *     sessionStore: new FileSessionStore('./.telegram.session'),
 *   }),
 *   isGlobal: true,
 * });
 *
 * // Multiple named accounts (each with its own session store).
 * @Module({
 *   imports: [
 *     TelegramClientModule.forRoot({ name: 'personal', apiId, apiHash, sessionStore: personalStore }),
 *     TelegramClientModule.forRoot({ name: 'ops', apiId, apiHash, sessionStore: opsStore }),
 *   ],
 * })
 * export class AppModule {}
 *
 * // Inject by name:
 * constructor(@InjectTelegramUser('personal') private readonly personal: TelegramUserService) {}
 * ```
 *
 * KEY EXPORTS
 * -----------
 * - TelegramClientModule: The dynamic module with name-aware `forRoot`/`forRootAsync`.
 */

import {
  type DynamicModule,
  type InjectionToken,
  Module,
  type Provider,
} from '@nestjs/common';
import {
  DiscoveryModule,
  DiscoveryService,
  MetadataScanner,
  Reflector,
} from '@nestjs/core';

import type { IGramClient } from './gram-client.interface';
import type { SessionStore } from './session/session-store.interface';
import { TelegramAuthService } from './telegram-auth.service';
import { DEFAULT_CLIENT_NAME } from './telegram-client.constants';
import { createConnectedGramClient } from './telegram-client.factory';
import { TelegramClientLifecycle } from './telegram-client.lifecycle';
import {
  ConfigurableModuleClass,
  TELEGRAM_CLIENT_OPTIONS,
  type TelegramClientModuleAsyncOptions,
  type TelegramClientModuleForRootOptions,
} from './telegram-client.module-definition';
import type { TelegramClientModuleOptions } from './telegram-client.options';
import {
  getClientLifecycleToken,
  getClientRegistrarToken,
  getGramClientToken,
  getSessionStoreToken,
  getTelegramAuthToken,
  getTelegramUserToken,
} from './telegram-client.tokens';
import { TelegramUserService } from './telegram-user.service';
import { TelegramUserUpdatesRegistrar } from './updates/telegram-user-updates.registrar';

/**
 * Builds the per-account DI providers: the session store, the connected
 * `IGramClient`, the auth and user services, the lifecycle disposer, and the
 * update registrar. All read the module-local `TELEGRAM_CLIENT_OPTIONS`, so each
 * registration stays isolated, and each is provided under a per-name token so
 * multiple accounts never collide.
 *
 * The services/lifecycle/registrar are provided via factories (not `useClass`) so
 * the per-account client/store can be passed explicitly — the same reason they
 * are constructable directly in tests.
 *
 * @param name - The account's name (`DEFAULT_CLIENT_NAME` for the default account).
 * @returns The provider set for this account.
 * @throws Never.
 */
function createClientProviders(name: string): Provider[] {
  const clientToken = getGramClientToken(name);
  const storeToken = getSessionStoreToken(name);
  const userToken = getTelegramUserToken(name);
  return [
    // ── Configured session store (or undefined) for this account. ─────────────
    {
      provide: storeToken,
      useFactory: (
        options: TelegramClientModuleOptions,
      ): SessionStore | undefined => options.sessionStore,
      inject: [TELEGRAM_CLIENT_OPTIONS],
    },
    // ── Connected IGramClient, built from this registration's options. ────────
    {
      provide: clientToken,
      useFactory: (
        options: TelegramClientModuleOptions,
        store?: SessionStore,
      ): Promise<IGramClient> => createConnectedGramClient(options, store),
      inject: [TELEGRAM_CLIENT_OPTIONS, { token: storeToken, optional: true }],
    },
    // ── Login orchestrator (persists to this account's store). ────────────────
    {
      provide: getTelegramAuthToken(name),
      useFactory: (
        client: IGramClient,
        store?: SessionStore,
      ): TelegramAuthService => new TelegramAuthService(client, store),
      inject: [clientToken, { token: storeToken, optional: true }],
    },
    // ── "Act as the account" facade + inbound updates$ source. ────────────────
    {
      provide: userToken,
      useFactory: (client: IGramClient): TelegramUserService =>
        new TelegramUserService(client),
      inject: [clientToken],
    },
    // ── Disconnects this account's client on shutdown. ────────────────────────
    {
      provide: getClientLifecycleToken(name),
      useFactory: (client: IGramClient): TelegramClientLifecycle =>
        new TelegramClientLifecycle(client),
      inject: [clientToken],
    },
    // ── Subscribes this account's @OnUserMessage handlers, scoped by name. ────
    {
      provide: getClientRegistrarToken(name),
      useFactory: (
        discovery: DiscoveryService,
        scanner: MetadataScanner,
        reflector: Reflector,
        userService: TelegramUserService,
      ): TelegramUserUpdatesRegistrar =>
        new TelegramUserUpdatesRegistrar(
          name,
          discovery,
          scanner,
          reflector,
          userService,
        ),
      inject: [DiscoveryService, MetadataScanner, Reflector, userToken],
    },
  ];
}

/**
 * The tokens an account exports to consumers: its raw client, session store, and
 * the two services. The internal lifecycle/registrar are not exported.
 *
 * @param name - The account's name (`DEFAULT_CLIENT_NAME` for the default account).
 * @returns The exported tokens for this account.
 * @throws Never.
 */
function createClientExports(name: string): InjectionToken[] {
  return [
    getGramClientToken(name),
    getSessionStoreToken(name),
    getTelegramAuthToken(name),
    getTelegramUserToken(name),
  ];
}

/**
 * Appends one account's providers and exports onto a generated dynamic module.
 *
 * @param dynamicModule - The dynamic module produced by the base
 *   `ConfigurableModuleClass` (it carries the options provider and global flag).
 * @param name - The account's name.
 * @returns The dynamic module augmented with this account's providers/exports.
 * @throws Never.
 */
function withClientProviders(
  dynamicModule: DynamicModule,
  name: string,
): DynamicModule {
  return {
    ...dynamicModule,
    providers: [
      ...(dynamicModule.providers ?? []),
      ...createClientProviders(name),
    ],
    exports: [...(dynamicModule.exports ?? []), ...createClientExports(name)],
  };
}

/**
 * MTProto feature module. Extends the generated `ConfigurableModuleClass` to
 * inherit fully-typed `forRoot` / `forRootAsync`, then augments their output with
 * this library's per-account providers (client, session store, services,
 * lifecycle, registrar).
 *
 * `DiscoveryModule` powers the `@OnUserMessage` system: each account's registrar
 * subscribes its discovered, name-matched handlers to that account's `updates$`.
 */
@Module({ imports: [DiscoveryModule] })
export class TelegramClientModule extends ConfigurableModuleClass {
  /**
   * Registers an account synchronously. Pass `name` to register one of several
   * accounts; omit it for the single default account.
   *
   * @param options - Client options plus the `isGlobal` / `name` extras.
   * @returns A dynamic module wiring this account's client, services, and registrar.
   * @throws Never (a failed eager connect is logged at provider construction).
   */
  public static forRoot(
    options: TelegramClientModuleForRootOptions,
  ): DynamicModule {
    return withClientProviders(
      super.forRoot(options),
      options.name ?? DEFAULT_CLIENT_NAME,
    );
  }

  /**
   * Registers an account asynchronously (`useFactory` / `useClass` /
   * `useExisting`). `name` is a synchronous sibling of the async options — it must
   * be known up front to compute the per-account tokens — so it sits alongside the
   * factory, not inside its resolved result.
   *
   * @param options - Async options plus the `isGlobal` / `name` extras.
   * @returns A dynamic module wiring this account's client, services, and registrar.
   * @throws Never (a failed eager connect is logged at provider construction).
   */
  public static forRootAsync(
    options: TelegramClientModuleAsyncOptions,
  ): DynamicModule {
    return withClientProviders(
      super.forRootAsync(options),
      options.name ?? DEFAULT_CLIENT_NAME,
    );
  }
}
