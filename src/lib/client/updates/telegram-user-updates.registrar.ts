/**
 * @file src/lib/client/updates/telegram-user-updates.registrar.ts
 *
 * PURPOSE
 * -------
 * Discovers every `@OnUserMessage`-decorated provider method at bootstrap and
 * subscribes it to {@link TelegramUserService.updates$}, applying the method's
 * filter and invoking it with the message plus a reply context. All
 * subscriptions are torn down on module destroy.
 *
 * USAGE
 * -----
 * Registered automatically as a provider by `TelegramClientModule`. Not used
 * directly by consumers.
 *
 * KEY EXPORTS
 * -----------
 * - TelegramUserUpdatesRegistrar: Wires decorated handlers to the message stream.
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
import { TelegramUserService } from '../telegram-user.service';
import { matchesUserMessageFilter } from './match-user-message';
import { ON_USER_MESSAGE_METADATA } from './on-user-message.decorator';
import type {
  GramUserMessageContext,
  OnUserMessageFilter,
  OnUserMessageHandler,
} from './on-user-message.types';

/**
 * Scans providers for `@OnUserMessage` handlers and bridges them to the inbound
 * message stream.
 */
@Injectable()
export class TelegramUserUpdatesRegistrar
  implements OnModuleInit, OnModuleDestroy
{
  /** Logger scoped to the registrar. */
  private readonly _logger = new Logger(TelegramUserUpdatesRegistrar.name);

  /** Active subscriptions, one per discovered handler. */
  private readonly _subscriptions: Subscription[] = [];

  /**
   * @param discovery - Enumerates the application's providers.
   * @param scanner - Lists method names on a provider prototype.
   * @param reflector - Reads the `@OnUserMessage` metadata off a method.
   * @param userService - Source of `updates$` and the reply transport.
   */
  public constructor(
    private readonly discovery: DiscoveryService,
    private readonly scanner: MetadataScanner,
    private readonly reflector: Reflector,
    private readonly userService: TelegramUserService,
  ) {}

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
    this._logger.log(`Registered @OnUserMessage handler: ${label}`);
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
