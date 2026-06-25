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
  type OnApplicationBootstrap,
  type OnModuleInit,
  type Type,
} from '@nestjs/common';
import { DiscoveryService, MetadataScanner, Reflector } from '@nestjs/core';
import { Telegraf, type Context } from 'telegraf';
import { message } from 'telegraf/filters';

import { TelegramConfigError } from '../../common';
import { decodeCallbackAction } from '../callback-action.codec';
import { TelegramBotScenesRegistrar } from '../scenes/telegram-bot-scenes.registrar';
import { DEFAULT_BOT_NAME } from '../telegram-bot.constants';
import type { TelegramBotModuleOptions } from '../telegram-bot.options';
import {
  buildCommandGroups,
  extractCommandNames,
  type CommandRegistrationGroup,
  type DeclaredCommand,
} from './command-registry';
import { dispatchToHandler } from './execution/handler-dispatch';
import { TelegramEnhancerResolver } from './execution/telegram-enhancer.resolver';
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

/**
 * Builds a Telegraf action **trigger function** that matches a callback query iff
 * its `{ a, d? }` envelope decodes to the given action key. Returning a synthetic
 * `RegExpExecArray` (carrying the raw data) signals a match the way a `RegExp`
 * trigger would; returning `null` is a non-match, so unknown/oversized/legacy
 * callback data falls through to other handlers (or is simply ignored) instead of
 * throwing — the graceful-handling requirement of the router.
 *
 * @param key - The action key this handler claims.
 * @returns A `(value) => RegExpExecArray | null` predicate for `Telegraf.action`.
 * @throws Never.
 */
function makeCallbackActionTrigger(
  key: string,
): (value: string) => RegExpExecArray | null {
  return (value: string): RegExpExecArray | null => {
    const decoded = decodeCallbackAction(value);
    if (decoded === null || decoded.key !== key) return null;
    // ── Telegraf assigns the returned array to `ctx.match`; mirror a RegExp
    //    match shape so the raw data is available there. The cast is safe: we
    //    construct exactly the array-plus-index/input the type describes. ───────
    const match = [value] as unknown as RegExpExecArray;
    match.index = 0;
    match.input = value;
    return match;
  };
}

/** A discovered handler binding, queued before it is applied to Telegraf. */
interface PendingBinding {
  /** The provider instance bound as `this`. */
  readonly instance: object;
  /** The provider class (for class-level enhancer metadata + execution context). */
  readonly metatype: Type;
  /** The method to execute — the instance's resolved method (override-aware). */
  readonly handler: TelegramUpdateHandler;
  /**
   * The function carrying the decorator metadata (bindings, params, enhancers).
   * Equals {@link PendingBinding.handler} for a normal method, but for an
   * overridden inherited handler it is the base-prototype function instead.
   */
  readonly decorated: TelegramUpdateHandler;
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
export class TelegramBotUpdatesRegistrar
  implements OnModuleInit, OnApplicationBootstrap
{
  /** Logger scoped to the registrar (annotated with the bot name when named). */
  private readonly _logger: Logger;

  /**
   * Validated `setMyCommands` payloads derived from `@Command` metadata in
   * {@link onModuleInit}, applied in {@link onApplicationBootstrap}. Empty unless
   * `options.commands.autoRegister` is enabled and described commands exist.
   */
  private _commandGroups: readonly CommandRegistrationGroup[] = [];

  /**
   * @param _botName - Name of the bot this registrar serves; only
   *   `@TelegramUpdate` providers whose target bot matches are bound.
   * @param discovery - Enumerates the application's providers.
   * @param scanner - Lists method names on a provider prototype.
   * @param reflector - Reads the decorator metadata off classes and methods.
   * @param enhancers - Resolves a handler's guard/interceptor/filter refs.
   * @param bot - The `Telegraf` instance this registrar's handlers are bound onto.
   * @param options - Module options for this bot; read for `commands.autoRegister`.
   * @param scenes - The scenes registrar for this bot; invoked during
   *   `onModuleInit` to register `@Scene`/`@WizardScene` providers (session +
   *   `Stage` middleware) between the `@Use()` middleware and terminal handlers.
   */
  public constructor(
    private readonly _botName: string,
    private readonly discovery: DiscoveryService,
    private readonly scanner: MetadataScanner,
    private readonly reflector: Reflector,
    private readonly enhancers: TelegramEnhancerResolver,
    private readonly bot: Telegraf,
    private readonly options: TelegramBotModuleOptions,
    private readonly scenes: TelegramBotScenesRegistrar,
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
        // ── The function to execute (override-aware): a subclass may override a
        //    decorated base method without re-decorating it. ───────────────────
        const handler = method as TelegramUpdateHandler;

        // ── Decorator metadata lives on the function it was applied to, which —
        //    for an overridden method — is a base-prototype function, not the
        //    instance's resolved method. Resolve it along the prototype chain so
        //    inherited handlers are not silently dropped. ──────────────────────
        const decorated =
          this.findDecoratedMethod(prototype, methodName) ?? handler;

        const bindings = this.reflector.get<UpdateBinding[]>(
          UPDATE_BINDINGS_METADATA,
          decorated,
        );
        if (!bindings || bindings.length === 0) continue;

        const params =
          this.reflector.get<ParamMetadata[]>(
            UPDATE_PARAMS_METADATA,
            decorated,
          ) ?? [];

        const label = `${wrapper.name ?? metatype.name}.${methodName}`;
        for (const binding of bindings)
          collected.push({
            instance: instance as object,
            // ── A discovered @TelegramUpdate provider always has a class. ─────
            metatype: metatype as Type,
            handler,
            decorated,
            params,
            binding,
            label,
          });
      }
    }

    // ── Three ordered registration phases on the shared Telegraf instance:
    //    (1) global @Use() middleware, (2) the scene session + Stage middleware,
    //    (3) terminal handlers. Telegraf runs middleware in registration order,
    //    so @Use() still sees every update, the scene Stage intercepts active
    //    scenes ahead of the terminal handlers, and a terminal match (which does
    //    not call next) cannot short-circuit either of the earlier phases. ─────
    const isUse = (entry: PendingBinding): boolean =>
      entry.binding.kind === BOT_UPDATE_KINDS.USE;
    for (const entry of collected) if (isUse(entry)) this.bind(entry);
    this.scenes.register();
    for (const entry of collected) if (!isUse(entry)) this.bind(entry);

    // ── Derive (and validate) the command menu now, before launch, so any
    //    misconfiguration fails fast; the API call itself waits for bootstrap. ─
    if (this.options.commands?.autoRegister)
      this._commandGroups = buildCommandGroups(
        this.collectDeclaredCommands(collected),
      );
  }

  /**
   * Harvests the described commands (`@Command(name, { description })`) from the
   * already-collected bindings into {@link DeclaredCommand}s for validation. Only
   * `COMMAND` bindings carrying a `description` are eligible; commands without a
   * description are handled but stay out of the menu.
   *
   * @param collected - The bindings gathered during discovery.
   * @returns One declaration per string command name, in discovery order.
   * @throws {TelegramConfigError} If a described command's trigger yields no
   *   string name (e.g. a `RegExp` trigger), which cannot become a menu entry.
   */
  private collectDeclaredCommands(
    collected: readonly PendingBinding[],
  ): DeclaredCommand[] {
    const declared: DeclaredCommand[] = [];
    for (const entry of collected) {
      const { binding, label } = entry;
      if (binding.kind !== BOT_UPDATE_KINDS.COMMAND) continue;
      if (binding.description === undefined) continue;

      const names = extractCommandNames(binding.trigger);
      if (names.length === 0)
        throw new TelegramConfigError(
          `@Command at ${label} has a description but no string command name; ` +
            'a RegExp/predicate trigger cannot be auto-registered in the command menu.',
        );

      for (const command of names)
        declared.push({
          command,
          description: binding.description,
          ...(binding.scope !== undefined && { scope: binding.scope }),
          ...(binding.languageCode !== undefined && {
            languageCode: binding.languageCode,
          }),
          source: label,
        });
    }
    return declared;
  }

  /**
   * Syncs the bot's command menu to Telegram after the application has
   * bootstrapped (and the bot has launched), making one `setMyCommands` call per
   * scope/language group derived in {@link onModuleInit}. A no-op when
   * `commands.autoRegister` is disabled or no described commands were found.
   *
   * Failures are logged, never thrown: a transient Bot API error syncing the
   * menu must not take down an otherwise-healthy application.
   *
   * @returns Resolves once every group has been sent (or logged as failed).
   * @throws Never.
   */
  public async onApplicationBootstrap(): Promise<void> {
    if (this._commandGroups.length === 0) return;

    for (const group of this._commandGroups) {
      // ── Build the extra only when a scope/language is set, so the default
      //    registration omits it entirely (matching Telegram's default menu). ─
      const extra =
        group.scope !== undefined || group.languageCode !== undefined
          ? {
              ...(group.scope !== undefined && { scope: group.scope }),
              ...(group.languageCode !== undefined && {
                language_code: group.languageCode,
              }),
            }
          : undefined;
      try {
        await this.bot.telegram.setMyCommands(group.commands, extra);
        this._logger.log(
          `Registered ${group.commands.length} command(s) for bot "${this._botName}"` +
            `${extra ? ' (scoped)' : ''}.`,
        );
      } catch (error) {
        const reason = error instanceof Error ? error.message : String(error);
        this._logger.error(
          `Failed to register commands for bot "${this._botName}": ${reason}`,
        );
      }
    }
  }

  /**
   * Walks the prototype chain from `prototype` (most-derived first) to find the
   * function for `methodName` that actually carries `@Command`/`@On`/… binding
   * metadata. When a subclass overrides a decorated base method without
   * re-decorating it, the function on the instance (the override that runs) has no
   * metadata while the base-prototype function does — so binding/param metadata
   * must be resolved along the chain, not just off the instance method.
   *
   * @param prototype - The instance's prototype (most-derived class prototype).
   * @param methodName - The method whose decorator metadata to locate.
   * @returns The metadata-carrying function, or `undefined` if none in the chain.
   * @throws Never.
   */
  private findDecoratedMethod(
    prototype: object | null,
    methodName: string,
  ): TelegramUpdateHandler | undefined {
    for (
      let proto: object | null = prototype;
      proto !== null && proto !== Object.prototype;
      proto = Object.getPrototypeOf(proto) as object | null
    ) {
      const candidate = (proto as Record<string, unknown>)[methodName];
      if (typeof candidate !== 'function') continue;
      const bindings = this.reflector.get<UpdateBinding[]>(
        UPDATE_BINDINGS_METADATA,
        candidate,
      );
      if (bindings && bindings.length > 0)
        return candidate as TelegramUpdateHandler;
    }
    return undefined;
  }

  /**
   * Binds a single pending binding onto the matching `Telegraf` method, wrapping
   * dispatch with the handler's resolved enhancers.
   *
   * Matched handlers (`start`, `help`, `command`, `hears`, `action`, `on`,
   * inline-query/chosen-result) are terminal — they do not call `next`, and the
   * dispatch's proceed signal is ignored. `@Use()` middleware calls `next` **only**
   * when dispatch reports the handler should proceed: a guard denial or an uncaught
   * error in the middleware blocks the rest of the chain for that update, mirroring
   * how a thrown Telegraf middleware stops propagation. Use a guard to conditionally
   * block; an exception is isolated (logged, never rethrown) but still halts the
   * current update's chain.
   *
   * @param entry - The pending binding to apply.
   * @returns Nothing.
   * @throws {import('../../common').TelegramConfigError} If an enhancer class ref
   *   cannot be resolved from the DI container.
   */
  private bind(entry: PendingBinding): void {
    const { instance, metatype, handler, decorated, params, binding, label } =
      entry;

    // ── Resolve enhancers once per binding (metadata is fixed at bootstrap).
    //    Read off `decorated` so inherited guards/filters/interceptors on an
    //    overridden handler are not lost. ──────────────────────────────────────
    const enhancers = this.enhancers.resolve(metatype, decorated);
    // ── A callback-action binding may carry a payload schema; thread it so the
    //    resolver validates any @CallbackPayload() arg. Undefined otherwise. ────
    const callbackActionSchema =
      binding.kind === BOT_UPDATE_KINDS.CALLBACK_ACTION
        ? binding.schema
        : undefined;
    // ── Returns whether the middleware chain should proceed: true on success,
    //    false when a guard denied the update or the handler threw uncaught. ───
    const proceed = (ctx: Context): Promise<boolean> =>
      dispatchToHandler(
        {
          instance,
          metatype,
          handler,
          decorated,
          params,
          callbackActionSchema,
          enhancers,
          label,
        },
        ctx,
        this._logger,
      );
    // ── Terminal handlers never continue a chain — run and resolve void. ──────
    const terminal = async (ctx: Context): Promise<void> => {
      await proceed(ctx);
    };

    switch (binding.kind) {
      case BOT_UPDATE_KINDS.START:
        this.bot.start(terminal);
        break;
      case BOT_UPDATE_KINDS.HELP:
        this.bot.help(terminal);
        break;
      case BOT_UPDATE_KINDS.COMMAND:
        this.bot.command(binding.trigger, terminal);
        break;
      case BOT_UPDATE_KINDS.HEARS:
        this.bot.hears(binding.trigger, terminal);
        break;
      case BOT_UPDATE_KINDS.ACTION:
        this.bot.action(binding.trigger, terminal);
        break;
      case BOT_UPDATE_KINDS.CALLBACK_ACTION:
        // ── Route by decoded action key via a trigger predicate; the schema (if
        //    any) is applied during argument resolution, not here. ──────────────
        this.bot.action(makeCallbackActionTrigger(binding.key), terminal);
        break;
      case BOT_UPDATE_KINDS.ON:
        this.bot.on(binding.trigger, terminal);
        break;
      case BOT_UPDATE_KINDS.INLINE_QUERY:
        // ── With a pattern, use the dedicated matcher; without one, fall back
        //    to a raw `on('inline_query')` so every query is handled. ─────────
        if (binding.trigger !== undefined)
          this.bot.inlineQuery(binding.trigger, terminal);
        else this.bot.on('inline_query', terminal);
        break;
      case BOT_UPDATE_KINDS.CHOSEN_INLINE_RESULT:
        this.bot.on('chosen_inline_result', terminal);
        break;
      case BOT_UPDATE_KINDS.PRE_CHECKOUT_QUERY:
        this.bot.on('pre_checkout_query', terminal);
        break;
      case BOT_UPDATE_KINDS.SHIPPING_QUERY:
        this.bot.on('shipping_query', terminal);
        break;
      case BOT_UPDATE_KINDS.SUCCESSFUL_PAYMENT:
        // ── `successful_payment` is a message subtype, not a top-level update
        //    type — match it via the `message(...)` filter (the non-deprecated
        //    path that survives Telegraf v5) rather than a raw string on(). ─────
        this.bot.on(message('successful_payment'), terminal);
        break;
      case BOT_UPDATE_KINDS.USE:
        this.bot.use(async (ctx: Context, next: () => Promise<void>) => {
          // ── Only advance the chain when the handler completed without a guard
          //    denial or an uncaught error; a denied/failed @Use blocks it. ────
          if (await proceed(ctx)) await next();
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
}
