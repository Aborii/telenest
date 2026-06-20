/**
 * @file src/lib/bot/updates/telegram-bot-updates.registrar.ts
 *
 * PURPOSE
 * -------
 * Discovers every `@TelegramUpdate` provider at bootstrap and binds each of its
 * decorated methods onto the shared `Telegraf` instance, resolving handler
 * arguments through the parameter metadata and isolating handler errors. Binding
 * happens in `onModuleInit`, which Nest runs before
 * {@link import('../telegram-bot.service').TelegramBotService}'s
 * `onApplicationBootstrap` launches the bot — so handlers are always wired up
 * before the first update is polled.
 *
 * USAGE
 * -----
 * Registered automatically as a provider by `TelegramBotModule`. Not used
 * directly by consumers.
 *
 * KEY EXPORTS
 * -----------
 * - TelegramBotUpdatesRegistrar: binds decorated handlers to Telegraf.
 */

import { Inject, Injectable, Logger, type OnModuleInit } from '@nestjs/common';
import { DiscoveryService, MetadataScanner, Reflector } from '@nestjs/core';
import { Telegraf, type Context } from 'telegraf';
import { TELEGRAM_BOT } from '../telegram-bot.constants';
import { resolveHandlerArguments } from './argument-resolver';
import {
  BOT_UPDATE_KINDS,
  IS_TELEGRAM_UPDATE_METADATA,
  UPDATE_BINDINGS_METADATA,
  UPDATE_PARAMS_METADATA,
  type ParamMetadata,
  type TelegramUpdateHandler,
  type UpdateBinding,
} from './telegram-update.types';

/**
 * Scans `@TelegramUpdate` providers and bridges their decorated methods onto the
 * Bot API via the underlying `Telegraf` instance.
 */
@Injectable()
export class TelegramBotUpdatesRegistrar implements OnModuleInit {
  /** Logger scoped to the registrar. */
  private readonly _logger = new Logger(TelegramBotUpdatesRegistrar.name);

  /**
   * @param discovery - Enumerates the application's providers.
   * @param scanner - Lists method names on a provider prototype.
   * @param reflector - Reads the decorator metadata off classes and methods.
   * @param bot - The shared `Telegraf` instance handlers are bound onto.
   */
  public constructor(
    private readonly discovery: DiscoveryService,
    private readonly scanner: MetadataScanner,
    private readonly reflector: Reflector,
    @Inject(TELEGRAM_BOT) private readonly bot: Telegraf,
  ) {}

  /**
   * Discovers and binds every decorated handler. Runs once, before launch.
   *
   * @returns Nothing.
   * @throws Never.
   */
  public onModuleInit(): void {
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
          this.bind(instance as object, handler, params, binding, label);
      }
    }
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
      `Registered @TelegramUpdate handler: ${label} (${binding.kind})`,
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
