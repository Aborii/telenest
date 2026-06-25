/**
 * @file src/lib/client/updates/telegram-user-updates.registrar.ts
 *
 * PURPOSE
 * -------
 * Discovers the inbound-update handler methods targeting **one** account at
 * bootstrap and subscribes each to the matching stream on that account's
 * {@link TelegramUserService}, applying the method's filter and invoking it with
 * the event (plus, for message-like handlers, a reply context). All four handler
 * decorators are wired here:
 *
 * - `@OnUserMessage` → `updates$`
 * - `@OnUserEdited`  → `editedMessages$`
 * - `@OnUserDeleted` → `deletedMessages$`
 * - `@OnChatAction`  → `chatActions$`
 *
 * All subscriptions are torn down on module destroy.
 *
 * One registrar is created per registered account (see `telegram-client.module.ts`),
 * each carrying its account name and `TelegramUserService`. Discovery enumerates
 * every provider in the app, so each registrar subscribes only the handlers whose
 * target account (recorded by the decorator's `{ client }` option) matches its
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
 * - TelegramUserUpdatesRegistrar: Wires decorated handlers to an account's streams.
 */

import {
  Injectable,
  Logger,
  type OnModuleDestroy,
  type OnModuleInit,
} from '@nestjs/common';
import { DiscoveryService, MetadataScanner, Reflector } from '@nestjs/core';
import type { Observable, Subscription } from 'rxjs';
import { filter as rxFilter } from 'rxjs/operators';

import type {
  GramChatActionEvent,
  GramDeletedMessages,
  GramMessage,
} from '../gram-client.types';
import { DEFAULT_CLIENT_NAME } from '../telegram-client.constants';
import { TelegramUserService } from '../telegram-user.service';
import { matchesChatActionFilter } from './match-chat-action';
import { matchesUserDeletedFilter } from './match-user-deleted';
import { matchesUserMessageFilter } from './match-user-message';
import {
  ON_CHAT_ACTION_CLIENT_METADATA,
  ON_CHAT_ACTION_METADATA,
} from './on-chat-action.decorator';
import type {
  OnChatActionFilter,
  OnChatActionHandler,
} from './on-chat-action.types';
import {
  ON_USER_DELETED_CLIENT_METADATA,
  ON_USER_DELETED_METADATA,
} from './on-user-deleted.decorator';
import type {
  OnUserDeletedFilter,
  OnUserDeletedHandler,
} from './on-user-deleted.types';
import {
  ON_USER_EDITED_CLIENT_METADATA,
  ON_USER_EDITED_METADATA,
} from './on-user-edited.decorator';
import {
  ON_USER_MESSAGE_CLIENT_METADATA,
  ON_USER_MESSAGE_METADATA,
} from './on-user-message.decorator';
import type {
  GramUserMessageContext,
  OnUserMessageFilter,
  OnUserMessageHandler,
} from './on-user-message.types';

/** A discovered method, narrowed to a callable. */
type AnyHandler = (...args: unknown[]) => unknown;

/**
 * Scans providers for the inbound-update handlers targeting one account and
 * bridges them to that account's matching streams.
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
   *   handlers whose target account matches are subscribed.
   * @param discovery - Enumerates the application's providers.
   * @param scanner - Lists method names on a provider prototype.
   * @param reflector - Reads the handler metadata off a method.
   * @param userService - This account's source of update streams and reply transport.
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
   * Discovers and subscribes every decorated handler, across all update kinds.
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

        // ── A provider/method name can be a Symbol (a template literal throws
        //    on one), so stringify both parts defensively. ─────────────────────
        const label = `${String(wrapper.name ?? 'provider')}.${String(methodName)}`;
        this.registerForMethod(instance, method as AnyHandler, label);
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
   * Inspects one provider method for each of the four update-handler decorators
   * and subscribes those that target this registrar's account.
   *
   * @param instance - The provider instance owning the method.
   * @param method - The candidate method.
   * @param label - Human-readable identifier for logs.
   * @returns Nothing.
   * @throws Never.
   */
  private registerForMethod(
    instance: object,
    method: AnyHandler,
    label: string,
  ): void {
    // ── @OnUserMessage → updates$ (with reply context). ──────────────────────
    this.registerKind<OnUserMessageFilter>(
      method,
      ON_USER_MESSAGE_METADATA,
      ON_USER_MESSAGE_CLIENT_METADATA,
      (filter) =>
        this.subscribeMessageLike(
          this.userService.updates$,
          instance,
          method as OnUserMessageHandler,
          filter,
          '@OnUserMessage',
          label,
        ),
    );

    // ── @OnUserEdited → editedMessages$ (with reply context). ────────────────
    this.registerKind<OnUserMessageFilter>(
      method,
      ON_USER_EDITED_METADATA,
      ON_USER_EDITED_CLIENT_METADATA,
      (filter) =>
        this.subscribeMessageLike(
          this.userService.editedMessages$,
          instance,
          method as OnUserMessageHandler,
          filter,
          '@OnUserEdited',
          label,
        ),
    );

    // ── @OnUserDeleted → deletedMessages$ (event only). ──────────────────────
    this.registerKind<OnUserDeletedFilter>(
      method,
      ON_USER_DELETED_METADATA,
      ON_USER_DELETED_CLIENT_METADATA,
      (filter) =>
        this.subscribeEvent(
          this.userService.deletedMessages$,
          (event: GramDeletedMessages) =>
            matchesUserDeletedFilter(event, filter),
          instance,
          method as OnUserDeletedHandler,
          '@OnUserDeleted',
          label,
        ),
    );

    // ── @OnChatAction → chatActions$ (event only). ───────────────────────────
    this.registerKind<OnChatActionFilter>(
      method,
      ON_CHAT_ACTION_METADATA,
      ON_CHAT_ACTION_CLIENT_METADATA,
      (filter) =>
        this.subscribeEvent(
          this.userService.chatActions$,
          (event: GramChatActionEvent) =>
            matchesChatActionFilter(event, filter),
          instance,
          method as OnChatActionHandler,
          '@OnChatAction',
          label,
        ),
    );
  }

  /**
   * Reads a single decorator's metadata off a method and, when present and
   * scoped to this account, invokes the supplied subscriber with the filter.
   *
   * @param method - The candidate method.
   * @param metaKey - Metadata key holding this kind's filter.
   * @param clientKey - Metadata key holding this kind's target account name.
   * @param subscribe - Callback that wires the handler given its filter.
   * @returns Nothing.
   * @throws Never.
   */
  private registerKind<F>(
    method: AnyHandler,
    metaKey: string,
    clientKey: string,
    subscribe: (filter: F) => void,
  ): void {
    const filter = this.reflector.get<F | undefined>(metaKey, method);
    if (filter === undefined) return;

    // ── Scope to this registrar's account: a handler declares its target
    //    account via the decorator's `{ client }` option (default account when
    //    omitted). Other accounts' handlers are wired by their own registrar. ──
    const targetClient =
      this.reflector.get<string>(clientKey, method) ?? DEFAULT_CLIENT_NAME;
    if (targetClient !== this._accountName) return;

    subscribe(filter);
  }

  /**
   * Subscribes a message-like handler (new or edited message) to a stream,
   * applying the message filter and invoking it with a reply context.
   *
   * @param stream - The source stream (`updates$` or `editedMessages$`).
   * @param instance - The provider instance owning the method.
   * @param handler - The decorated method.
   * @param filter - The handler's match criteria.
   * @param kind - Decorator name, for log lines.
   * @param label - Human-readable identifier for logs.
   * @returns Nothing.
   * @throws Never.
   */
  private subscribeMessageLike(
    stream: Observable<GramMessage>,
    instance: object,
    handler: OnUserMessageHandler,
    filter: OnUserMessageFilter,
    kind: string,
    label: string,
  ): void {
    const subscription = stream
      .pipe(rxFilter((message) => matchesUserMessageFilter(message, filter)))
      .subscribe((message) => {
        const context: GramUserMessageContext = {
          message,
          reply: (text) => this.userService.sendMessage(message.peerId, text),
        };
        void this.invoke(
          instance,
          handler as AnyHandler,
          [message, context],
          kind,
          label,
        );
      });

    this._subscriptions.push(subscription);
    this.logRegistered(kind, label);
  }

  /**
   * Subscribes an event-only handler (deleted messages or chat action) to a
   * stream, applying its predicate and invoking it with just the event.
   *
   * @param stream - The source stream.
   * @param matches - Predicate selecting events for this handler.
   * @param instance - The provider instance owning the method.
   * @param handler - The decorated method.
   * @param kind - Decorator name, for log lines.
   * @param label - Human-readable identifier for logs.
   * @returns Nothing.
   * @throws Never.
   */
  private subscribeEvent<T>(
    stream: Observable<T>,
    matches: (event: T) => boolean,
    instance: object,
    handler: (event: T) => unknown,
    kind: string,
    label: string,
  ): void {
    const subscription = stream
      .pipe(rxFilter(matches))
      .subscribe((event) => {
        void this.invoke(instance, handler as AnyHandler, [event], kind, label);
      });

    this._subscriptions.push(subscription);
    this.logRegistered(kind, label);
  }

  /**
   * Invokes a handler with the prepared arguments, isolating errors so one
   * failing handler never breaks the stream for the others.
   *
   * @param instance - The provider instance (bound as `this`).
   * @param handler - The decorated method.
   * @param args - The positional arguments to pass.
   * @param kind - Decorator name, for diagnostics.
   * @param label - Identifier for diagnostics.
   * @returns Resolves once the handler settles.
   * @throws Never (handler errors are logged, not rethrown).
   */
  private async invoke(
    instance: object,
    handler: AnyHandler,
    args: unknown[],
    kind: string,
    label: string,
  ): Promise<void> {
    try {
      await handler.call(instance, ...args);
    } catch (error) {
      const reason = error instanceof Error ? error.message : String(error);
      this._logger.error(`${kind} handler ${label} threw: ${reason}`);
    }
  }

  /**
   * Emits the "registered handler" log line.
   *
   * @param kind - Decorator name.
   * @param label - Human-readable handler identifier.
   * @returns Nothing.
   * @throws Never.
   */
  private logRegistered(kind: string, label: string): void {
    this._logger.log(
      `Registered ${kind} handler: ${label} → account "${this._accountName}"`,
    );
  }
}
