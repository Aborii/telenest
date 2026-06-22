/**
 * @file src/lib/bot/updates/telegram-bot-updates.registrar.ts
 *
 * PURPOSE
 * -------
 * Discovers the `@TelegramUpdate` providers targeting **one** bot at bootstrap
 * and binds each of their decorated methods onto that bot's `Telegraf` instance,
 * resolving handler arguments through the parameter metadata and running each
 * handler through any guards, interceptors, and exception filters it declares via
 * the `@UseTelegram*` decorators. Binding happens in `onModuleInit`, which Nest
 * runs before
 * {@link import('../telegram-bot.service').TelegramBotService}'s
 * `onApplicationBootstrap` launches the bot — so handlers (and their enhancers)
 * are always wired up before the first update is polled.
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

import {
  Injectable,
  Logger,
  type OnModuleInit,
  type Type,
} from '@nestjs/common';
import { DiscoveryService, MetadataScanner, Reflector } from '@nestjs/core';
import { type Context, Telegraf } from 'telegraf';

import { DEFAULT_BOT_NAME } from '../telegram-bot.constants';
import { resolveHandlerArguments } from './argument-resolver';
import type { ResolvedEnhancers } from './execution/enhancer.types';
import { RUN_OUTCOMES, runWithEnhancers } from './execution/handler-execution';
import { TelegramEnhancerResolver } from './execution/telegram-enhancer.resolver';
import { TelegramExecutionContext } from './execution/telegram-execution-context';
import {
  BOT_UPDATE_KINDS,
  IS_TELEGRAM_UPDATE_METADATA,
  type ParamMetadata,
  TELEGRAM_UPDATE_BOT_METADATA,
  type TelegramUpdateHandler,
  UPDATE_BINDINGS_METADATA,
  UPDATE_PARAMS_METADATA,
  type UpdateBinding,
} from './telegram-update.types';

/** A discovered handler binding, queued before it is applied to Telegraf. */
interface PendingBinding {
  /** The provider instance bound as `this`. */
  readonly instance: object;
  /** The provider class (for class-level enhancer metadata + execution context). */
  readonly metatype: Type;
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
 * decorated methods onto the Bot API via that bot's `Telegraf` instance, applying
 * each handler's guards, interceptors, and exception filters around the call.
 *
 * Instantiated by `TelegramBotModule`'s per-bot factory provider (never as a
 * plain class provider), which supplies the bot name, the enhancer resolver, and
 * the `Telegraf` instance explicitly — so the non-injectable `_botName`
 * constructor parameter is always provided by the factory, not resolved by DI.
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
   * @param enhancers - Resolves a handler's guard/interceptor/filter refs.
   * @param bot - The `Telegraf` instance this registrar's handlers are bound onto.
   */
  public constructor(
    private readonly _botName: string,
    private readonly discovery: DiscoveryService,
    private readonly scanner: MetadataScanner,
    private readonly reflector: Reflector,
    private readonly enhancers: TelegramEnhancerResolver,
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
   * @throws {import('../../common').TelegramConfigError} If an enhancer class
   *   ref on a discovered handler cannot be resolved from the DI container.
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
            // ── A discovered @TelegramUpdate provider always has a class. ─────
            metatype: metatype as Type,
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
    for (const entry of collected) if (isUse(entry)) this.bind(entry);
    for (const entry of collected) if (!isUse(entry)) this.bind(entry);
  }

  /**
   * Binds a single pending binding onto the matching `Telegraf` method, wrapping
   * dispatch with the handler's resolved enhancers.
   *
   * Matched handlers (`start`, `help`, `command`, `hears`, `action`, `on`) are
   * terminal — they do not call `next`. `@Use()` middleware calls `next` after
   * the handler so the middleware chain continues.
   *
   * @param entry - The pending binding to apply.
   * @returns Nothing.
   * @throws {import('../../common').TelegramConfigError} If an enhancer class ref
   *   cannot be resolved from the DI container.
   */
  private bind(entry: PendingBinding): void {
    const { instance, metatype, handler, params, binding, label } = entry;

    // ── Resolve enhancers once per binding (metadata is fixed at bootstrap). ──
    const enhancers = this.enhancers.resolve(metatype, handler);
    const run = (ctx: Context): Promise<void> =>
      this.dispatch(instance, metatype, handler, params, ctx, label, enhancers);

    switch (binding.kind) {
      case BOT_UPDATE_KINDS.START:
        this.bot.start((ctx: Context) => run(ctx));
        break;
      case BOT_UPDATE_KINDS.HELP:
        this.bot.help((ctx: Context) => run(ctx));
        break;
      case BOT_UPDATE_KINDS.COMMAND:
        this.bot.command(binding.trigger, (ctx: Context) => run(ctx));
        break;
      case BOT_UPDATE_KINDS.HEARS:
        this.bot.hears(binding.trigger, (ctx: Context) => run(ctx));
        break;
      case BOT_UPDATE_KINDS.ACTION:
        this.bot.action(binding.trigger, (ctx: Context) => run(ctx));
        break;
      case BOT_UPDATE_KINDS.ON:
        this.bot.on(binding.trigger, (ctx: Context) => run(ctx));
        break;
      case BOT_UPDATE_KINDS.USE:
        this.bot.use(async (ctx: Context, next: () => Promise<void>) => {
          await run(ctx);
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
   * Dispatches one update to a handler. Handlers without any enhancers take the
   * fast path ({@link TelegramBotUpdatesRegistrar.invoke}); otherwise the call is
   * run through the guard/interceptor/filter pipeline.
   *
   * @param instance - The provider instance (bound as `this`).
   * @param metatype - The provider class (for the execution context).
   * @param handler - The decorated method.
   * @param params - The method's parameter descriptors.
   * @param ctx - The Telegraf context for the current update.
   * @param label - Identifier for diagnostics.
   * @param enhancers - The handler's resolved guards/interceptors/filters.
   * @returns Resolves once the handler (and any enhancers) settle.
   * @throws Never (errors are routed to filters, else logged).
   */
  private async dispatch(
    instance: object,
    metatype: Type,
    handler: TelegramUpdateHandler,
    params: readonly ParamMetadata[],
    ctx: Context,
    label: string,
    enhancers: ResolvedEnhancers,
  ): Promise<void> {
    // ── Fast path: nothing to wrap, behave exactly like the plain invoke. ─────
    if (
      enhancers.guards.length === 0 &&
      enhancers.interceptors.length === 0 &&
      enhancers.filters.length === 0
    )
      return this.invoke(instance, handler, params, ctx, label);

    const context = new TelegramExecutionContext(ctx, metatype, handler);
    try {
      const outcome = await runWithEnhancers({
        context,
        enhancers,
        handler: () =>
          handler.apply(instance, resolveHandlerArguments(ctx, params)),
      });
      if (outcome === RUN_OUTCOMES.DENIED)
        this._logger.debug(
          `@TelegramUpdate handler ${label} was blocked by a guard`,
        );
    } catch (error) {
      // ── No filter handled it: preserve the isolate-and-log guarantee. ───────
      const reason = error instanceof Error ? error.message : String(error);
      this._logger.error(`@TelegramUpdate handler ${label} threw: ${reason}`);
    }
  }

  /**
   * Invokes a handler with resolved arguments, isolating errors so one failing
   * handler never breaks the update pipeline for the others. Used for handlers
   * with no enhancers configured.
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
