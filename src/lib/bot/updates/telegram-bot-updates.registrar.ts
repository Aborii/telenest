/**
 * @file src/lib/bot/updates/telegram-bot-updates.registrar.ts
 *
 * PURPOSE
 * -------
 * Discovers the `@TelegramUpdate` providers targeting **one** bot at bootstrap
 * and binds each of their decorated methods onto that bot's `Telegraf` instance,
 * resolving handler arguments through the parameter metadata and isolating
 * handler errors. Binding happens in `onModuleInit`, which Nest runs before
 * {@link import('../telegram-bot.service').TelegramBotService}'s
 * `onApplicationBootstrap` launches the bot — so handlers are always wired up
 * before the first update is polled.
 *
 * One registrar is created per registered bot (see `telegram-bot.module.ts`),
 * each carrying its bot name and `Telegraf` instance. Discovery enumerates every
 * provider in the app, so each registrar filters to the providers whose target
 * bot (recorded by `@TelegramUpdate({ bot })`) matches its own name — that is how
 * a handler is bound onto exactly one bot in a multi-bot application.
 *
 * USAGE
 * -----
 * Registered automatically (one per bot) by `TelegramBotModule`. Not used
 * directly by consumers.
 *
 * KEY EXPORTS
 * -----------
 * - TelegramBotUpdatesRegistrar: binds decorated handlers to a named bot.
 */

import { Injectable, Logger, type OnModuleInit } from '@nestjs/common';
import { DiscoveryService, MetadataScanner, Reflector } from '@nestjs/core';
import { Telegraf, type Context } from 'telegraf';
import { DEFAULT_BOT_NAME } from '../telegram-bot.constants';
import { resolveHandlerArguments } from './argument-resolver';
import {
  BOT_UPDATE_KINDS,
  IS_TELEGRAM_UPDATE_METADATA,
  TELEGRAM_UPDATE_BOT_METADATA,
  UPDATE_BINDINGS_METADATA,
  UPDATE_PARAMS_METADATA,
  type ParamMetadata,
  type TelegramUpdateHandler,
  type UpdateBinding,
} from './telegram-update.types';

/** A discovered handler binding, queued before it is applied to Telegraf. */
interface PendingBinding {
  /** The provider instance bound as `this`. */
  readonly instance: object;
  /** The decorated method. */
  readonly handler: TelegramUpdateHandler;
  /** The method's parameter descriptors. */
  readonly params: readonly ParamMetadata[];
  /** How the handler binds onto Telegraf. */
  readonly binding: UpdateBinding;
  /** Human-readable identifier for logs. */
  readonly label: string;
}

/**
 * Scans the `@TelegramUpdate` providers targeting one bot and bridges their
 * decorated methods onto the Bot API via that bot's `Telegraf` instance.
 *
 * Instantiated by `TelegramBotModule`'s per-bot factory provider (never as a
 * plain class provider), which supplies the bot name and `Telegraf` instance
 * explicitly — so the non-injectable `_botName` constructor parameter is always
 * provided by the factory, not resolved by Nest's DI.
 */
@Injectable()
export class TelegramBotUpdatesRegistrar implements OnModuleInit {
  /** Logger scoped to the registrar (annotated with the bot name when named). */
  private readonly _logger: Logger;

  /**
   * @param _botName - Name of the bot this registrar serves; only
   *   `@TelegramUpdate` providers whose target bot matches are bound.
   * @param discovery - Enumerates the application's providers.
   * @param scanner - Lists method names on a provider prototype.
   * @param reflector - Reads the decorator metadata off classes and methods.
   * @param bot - The `Telegraf` instance this registrar's handlers are bound onto.
   */
  public constructor(
    private readonly _botName: string,
    private readonly discovery: DiscoveryService,
    private readonly scanner: MetadataScanner,
    private readonly reflector: Reflector,
    private readonly bot: Telegraf,
  ) {
    // ── For the default bot keep the bare class name; annotate named bots so
    //    their binding logs are attributable in a multi-bot application. ──────
    this._logger = new Logger(
      _botName === DEFAULT_BOT_NAME
        ? TelegramBotUpdatesRegistrar.name
        : `${TelegramBotUpdatesRegistrar.name}[${_botName}]`,
    );
  }

  /**
   * Discovers and binds every decorated handler. Runs once, before launch.
   *
   * Bindings are collected first, then applied with all `@Use()` global
   * middleware **before** the terminal handlers — Telegraf runs middleware in
   * registration order, and a terminal handler (`@Command`, `@Hears`, …) that
   * matches first would otherwise short-circuit before global middleware ran.
   *
   * @returns Nothing.
   * @throws Never.
   */
  public onModuleInit(): void {
    const collected: PendingBinding[] = [];

    for (const wrapper of this.discovery.getProviders()) {
      const instance = wrapper.instance;
      const metatype = wrapper.metatype;
      if (!instance || typeof instance !== 'object' || !metatype) continue;

      // ── Only scan classes explicitly marked with @TelegramUpdate(). ─────────
      const isUpdate = this.reflector.get<boolean>(
        IS_TELEGRAM_UPDATE_METADATA,
        metatype,
      );
      if (!isUpdate) continue;

      // ── Scope to this registrar's bot: a provider declares its target bot via
      //    @TelegramUpdate({ bot }) (defaulting to the default bot). Providers
      //    for other bots are bound by their own registrar, not this one. ──────
      const targetBot =
        this.reflector.get<string>(TELEGRAM_UPDATE_BOT_METADATA, metatype) ??
        DEFAULT_BOT_NAME;
      if (targetBot !== this._botName) continue;

      const prototype = Object.getPrototypeOf(instance) as object | null;
      if (!prototype) continue;

      for (const methodName of this.scanner.getAllMethodNames(prototype)) {
        const method = (instance as Record<string, unknown>)[methodName];
        if (typeof method !== 'function') continue;
        // ── Narrowed to a function; the handler shape is loose by design. ─────
        const handler = method as TelegramUpdateHandler;

        const bindings = this.reflector.get<UpdateBinding[]>(
          UPDATE_BINDINGS_METADATA,
          handler,
        );
        if (!bindings || bindings.length === 0) continue;

        const params =
          this.reflector.get<ParamMetadata[]>(
            UPDATE_PARAMS_METADATA,
            handler,
          ) ?? [];

        const label = `${wrapper.name ?? metatype.name}.${methodName}`;
        for (const binding of bindings)
          collected.push({
            instance: instance as object,
            handler,
            params,
            binding,
            label,
          });
      }
    }

    // ── Two stable passes: global @Use() middleware first, terminal handlers
    //    second; discovery order is preserved within each group. ─────────────
    const isUse = (entry: PendingBinding): boolean =>
      entry.binding.kind === BOT_UPDATE_KINDS.USE;
    for (const entry of collected)
      if (isUse(entry))
        this.bind(entry.instance, entry.handler, entry.params, entry.binding, entry.label);
    for (const entry of collected)
      if (!isUse(entry))
        this.bind(entry.instance, entry.handler, entry.params, entry.binding, entry.label);
  }

  /**
   * Binds a single handler/binding pair onto the matching `Telegraf` method.
   *
   * Matched handlers (`start`, `help`, `command`, `hears`, `action`, `on`) are
   * terminal — they do not call `next`. `@Use()` middleware calls `next` after
   * the handler so the middleware chain continues.
   *
   * @param instance - The provider instance (bound as `this`).
   * @param handler - The decorated method.
   * @param params - The method's parameter descriptors.
   * @param binding - The binding describing how to register the handler.
   * @param label - Human-readable identifier for logs.
   * @returns Nothing.
   * @throws Never.
   */
  private bind(
    instance: object,
    handler: TelegramUpdateHandler,
    params: readonly ParamMetadata[],
    binding: UpdateBinding,
    label: string,
  ): void {
    switch (binding.kind) {
      case BOT_UPDATE_KINDS.START:
        this.bot.start((ctx: Context) =>
          this.invoke(instance, handler, params, ctx, label),
        );
        break;
      case BOT_UPDATE_KINDS.HELP:
        this.bot.help((ctx: Context) =>
          this.invoke(instance, handler, params, ctx, label),
        );
        break;
      case BOT_UPDATE_KINDS.COMMAND:
        this.bot.command(binding.trigger, (ctx: Context) =>
          this.invoke(instance, handler, params, ctx, label),
        );
        break;
      case BOT_UPDATE_KINDS.HEARS:
        this.bot.hears(binding.trigger, (ctx: Context) =>
          this.invoke(instance, handler, params, ctx, label),
        );
        break;
      case BOT_UPDATE_KINDS.ACTION:
        this.bot.action(binding.trigger, (ctx: Context) =>
          this.invoke(instance, handler, params, ctx, label),
        );
        break;
      case BOT_UPDATE_KINDS.ON:
        this.bot.on(binding.trigger, (ctx: Context) =>
          this.invoke(instance, handler, params, ctx, label),
        );
        break;
      case BOT_UPDATE_KINDS.USE:
        this.bot.use(async (ctx: Context, next: () => Promise<void>) => {
          await this.invoke(instance, handler, params, ctx, label);
          await next();
        });
        break;
      default: {
        // ── Exhaustiveness guard: an unhandled kind fails to compile. ─────────
        const exhaustive: never = binding;
        return exhaustive;
      }
    }

    this._logger.log(
      `Registered @TelegramUpdate handler: ${label} (${binding.kind}) → bot "${this._botName}"`,
    );
  }

  /**
   * Invokes a handler with resolved arguments, isolating errors so one failing
   * handler never breaks the update pipeline for the others.
   *
   * @param instance - The provider instance (bound as `this`).
   * @param handler - The decorated method.
   * @param params - The method's parameter descriptors.
   * @param ctx - The Telegraf context for the current update.
   * @param label - Identifier for diagnostics.
   * @returns Resolves once the handler settles.
   * @throws Never (handler errors are logged, not rethrown).
   */
  private async invoke(
    instance: object,
    handler: TelegramUpdateHandler,
    params: readonly ParamMetadata[],
    ctx: Context,
    label: string,
  ): Promise<void> {
    const args = resolveHandlerArguments(ctx, params);
    try {
      await handler.apply(instance, args);
    } catch (error) {
      const reason = error instanceof Error ? error.message : String(error);
      this._logger.error(`@TelegramUpdate handler ${label} threw: ${reason}`);
    }
  }
}
