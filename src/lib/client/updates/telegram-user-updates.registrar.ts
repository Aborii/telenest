/**
 * @file src/lib/client/updates/telegram-user-updates.registrar.ts
 *
 * PURPOSE
 * -------
 * Discovers the `@OnUserMessage`-decorated provider methods targeting **one**
 * account at bootstrap and subscribes each to that account's
 * {@link TelegramUserService.updates$}, applying the method's filter and invoking
 * it with the message plus a reply context. All subscriptions are torn down on
 * module destroy.
 *
 * One registrar is created per registered account (see `telegram-client.module.ts`),
 * each carrying its account name and `TelegramUserService`. Discovery enumerates
 * every provider in the app, so each registrar subscribes only the handlers whose
 * target account (recorded by `@OnUserMessage(filter, { client })`) matches its
 * own name — that is how a handler listens to exactly one account in a
 * multi-account application.
 *
 * USAGE
 * -----
 * Registered automatically (one per account) by `TelegramClientModule`. Not used
 * directly by consumers.
 *
 * KEY EXPORTS
 * -----------
 * - TelegramUserUpdatesRegistrar: Wires decorated handlers to an account's stream.
 */

import {
  Injectable,
  Logger,
  type OnModuleDestroy,
  type OnModuleInit,
} from '@nestjs/common';
import { DiscoveryService, MetadataScanner, Reflector } from '@nestjs/core';
import type { Subscription } from 'rxjs';
import { filter as rxFilter } from 'rxjs/operators';

import type { GramMessage } from '../gram-client.types';
import { DEFAULT_CLIENT_NAME } from '../telegram-client.constants';
import { TelegramUserService } from '../telegram-user.service';
import { matchesUserMessageFilter } from './match-user-message';
import {
  ON_USER_MESSAGE_CLIENT_METADATA,
  ON_USER_MESSAGE_METADATA,
} from './on-user-message.decorator';
import type {
  GramUserMessageContext,
  OnUserMessageFilter,
  OnUserMessageHandler,
} from './on-user-message.types';

/**
 * Scans providers for the `@OnUserMessage` handlers targeting one account and
 * bridges them to that account's inbound message stream.
 *
 * Instantiated by `TelegramClientModule`'s per-account factory provider (never as
 * a plain class provider), which supplies the account name and
 * `TelegramUserService` explicitly — so the non-injectable `_accountName`
 * constructor parameter is always provided by the factory, not resolved by DI.
 */
@Injectable()
export class TelegramUserUpdatesRegistrar
  implements OnModuleInit, OnModuleDestroy
{
  /** Logger scoped to the registrar (annotated with the account name when named). */
  private readonly _logger: Logger;

  /** Active subscriptions, one per discovered handler. */
  private readonly _subscriptions: Subscription[] = [];

  /**
   * @param _accountName - Name of the account this registrar serves; only
   *   `@OnUserMessage` handlers whose target account matches are subscribed.
   * @param discovery - Enumerates the application's providers.
   * @param scanner - Lists method names on a provider prototype.
   * @param reflector - Reads the `@OnUserMessage` metadata off a method.
   * @param userService - This account's source of `updates$` and reply transport.
   */
  public constructor(
    private readonly _accountName: string,
    private readonly discovery: DiscoveryService,
    private readonly scanner: MetadataScanner,
    private readonly reflector: Reflector,
    private readonly userService: TelegramUserService,
  ) {
    // ── For the default account keep the bare class name; annotate named
    //    accounts so their subscription logs are attributable. ────────────────
    this._logger = new Logger(
      _accountName === DEFAULT_CLIENT_NAME
        ? TelegramUserUpdatesRegistrar.name
        : `${TelegramUserUpdatesRegistrar.name}[${_accountName}]`,
    );
  }

  /**
   * Discovers and subscribes every decorated handler.
   *
   * @returns Nothing.
   * @throws Never.
   */
  public onModuleInit(): void {
    for (const wrapper of this.discovery.getProviders()) {
      const instance = wrapper.instance;
      if (!instance || typeof instance !== 'object') continue;

      const prototype = Object.getPrototypeOf(instance) as object | null;
      if (!prototype) continue;

      for (const methodName of this.scanner.getAllMethodNames(prototype)) {
        const method = (instance as Record<string, unknown>)[methodName];
        if (typeof method !== 'function') continue;

        const filter = this.reflector.get<OnUserMessageFilter>(
          ON_USER_MESSAGE_METADATA,
          method as (...args: unknown[]) => unknown,
        );
        if (!filter) continue;

        // ── Scope to this registrar's account: a handler declares its target
        //    account via @OnUserMessage(filter, { client }) (defaulting to the
        //    default account). Other accounts' handlers are subscribed by their
        //    own registrar, not this one. ─────────────────────────────────────
        const targetClient =
          this.reflector.get<string>(
            ON_USER_MESSAGE_CLIENT_METADATA,
            method as (...args: unknown[]) => unknown,
          ) ?? DEFAULT_CLIENT_NAME;
        if (targetClient !== this._accountName) continue;

        this.subscribe(
          instance as object,
          method as OnUserMessageHandler,
          filter,
          `${wrapper.name ?? 'provider'}.${methodName}`,
        );
      }
    }
  }

  /**
   * Unsubscribes every handler.
   *
   * @returns Nothing.
   * @throws Never.
   */
  public onModuleDestroy(): void {
    for (const subscription of this._subscriptions) subscription.unsubscribe();
    this._subscriptions.length = 0;
  }

  /**
   * Subscribes a single handler to the filtered message stream.
   *
   * @param instance - The provider instance owning the method.
   * @param handler - The decorated method.
   * @param filter - The handler's match criteria.
   * @param label - Human-readable identifier for logs.
   * @returns Nothing.
   * @throws Never.
   */
  private subscribe(
    instance: object,
    handler: OnUserMessageHandler,
    filter: OnUserMessageFilter,
    label: string,
  ): void {
    const subscription = this.userService.updates$
      .pipe(rxFilter((message) => matchesUserMessageFilter(message, filter)))
      .subscribe((message) => {
        void this.invoke(instance, handler, message, label);
      });

    this._subscriptions.push(subscription);
    this._logger.log(
      `Registered @OnUserMessage handler: ${label} → account "${this._accountName}"`,
    );
  }

  /**
   * Invokes a handler with the message and a reply context, isolating errors so
   * one failing handler never breaks the stream for the others.
   *
   * @param instance - The provider instance (bound as `this`).
   * @param handler - The decorated method.
   * @param message - The triggering message.
   * @param label - Identifier for diagnostics.
   * @returns Resolves once the handler settles.
   * @throws Never (handler errors are logged, not rethrown).
   */
  private async invoke(
    instance: object,
    handler: OnUserMessageHandler,
    message: GramMessage,
    label: string,
  ): Promise<void> {
    const context: GramUserMessageContext = {
      message,
      reply: (text) => this.userService.sendMessage(message.peerId, text),
    };

    try {
      await handler.call(instance, message, context);
    } catch (error) {
      const reason = error instanceof Error ? error.message : String(error);
      this._logger.error(`@OnUserMessage handler ${label} threw: ${reason}`);
    }
  }
}
