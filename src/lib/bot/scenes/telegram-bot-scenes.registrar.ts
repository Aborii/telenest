/**
 * @file src/lib/bot/scenes/telegram-bot-scenes.registrar.ts
 *
 * PURPOSE
 * -------
 * Discovers the `@Scene` / `@WizardScene` providers targeting **one** bot at
 * bootstrap, builds the matching Telegraf scenes (wiring each decorated method's
 * enter/leave hooks, message handlers, and wizard steps through the shared
 * dispatcher so guards/interceptors/filters and param injection work exactly as
 * they do for top-level handlers), groups them into a `Scenes.Stage`, and
 * registers the `session` + `stage` middleware on the bot's `Telegraf` instance.
 *
 * It is **not** a lifecycle hook of its own: the top-level
 * {@link import('../updates/telegram-bot-updates.registrar').TelegramBotUpdatesRegistrar}
 * calls {@link TelegramBotScenesRegistrar.register} from its `onModuleInit`,
 * *after* binding `@Use()` global middleware but *before* the terminal handlers.
 * That ordering is the whole point: global middleware still runs for every
 * update, while the scene `Stage` is registered ahead of the terminal
 * `bot.command`/`bot.hears`/… handlers so an active scene intercepts first.
 *
 * One registrar is created per registered bot; discovery enumerates every
 * provider, so each registrar filters to the scenes whose target bot matches its
 * own name — the same multi-bot scoping the update registrar uses.
 *
 * USAGE
 * -----
 * Registered automatically (one per bot) by `TelegramBotModule`. Not used
 * directly by consumers.
 *
 * KEY EXPORTS
 * -----------
 * - TelegramBotScenesRegistrar: builds + registers a bot's scenes/wizards.
 */

import { Injectable, Logger, type Type } from '@nestjs/common';
import { DiscoveryService, MetadataScanner, Reflector } from '@nestjs/core';
import {
  Scenes,
  session,
  type Context,
  type MiddlewareFn,
  type Telegraf,
} from 'telegraf';

import { DEFAULT_BOT_NAME } from '../telegram-bot.constants';
import type { TelegramBotModuleOptions } from '../telegram-bot.options';
import { dispatchToHandler } from '../updates/execution/handler-dispatch';
import { TelegramEnhancerResolver } from '../updates/execution/telegram-enhancer.resolver';
import {
  UPDATE_BINDINGS_METADATA,
  UPDATE_PARAMS_METADATA,
  type ParamMetadata,
  type TelegramUpdateHandler,
  type UpdateBinding,
} from '../updates/telegram-update.types';
import {
  buildScene,
  type SceneFlowContext,
  type SceneMethodSpec,
} from './scene.builder';
import {
  SCENE_DEFINITION_METADATA,
  SCENE_KINDS,
  SCENE_METHOD_BINDINGS_METADATA,
  type SceneDefinition,
  type SceneMethodBinding,
} from './scene.types';

/**
 * Scans the `@Scene`/`@WizardScene` providers targeting one bot and registers
 * them — and the required `session` middleware — onto that bot's `Telegraf`
 * instance via a single `Scenes.Stage`.
 *
 * Instantiated by `TelegramBotModule`'s per-bot factory provider (never as a
 * plain class provider), which supplies the bot name, the enhancer resolver, and
 * the `Telegraf` instance explicitly.
 */
@Injectable()
export class TelegramBotScenesRegistrar {
  /** Logger scoped to the registrar (annotated with the bot name when named). */
  private readonly _logger: Logger;

  /**
   * @param _botName - Name of the bot this registrar serves; only `@Scene`
   *   providers whose target bot matches are registered.
   * @param _discovery - Enumerates the application's providers.
   * @param _scanner - Lists method names on a provider prototype.
   * @param _reflector - Reads the decorator metadata off classes and methods.
   * @param _enhancers - Resolves a handler's guard/interceptor/filter refs.
   * @param _bot - The `Telegraf` instance the scenes are registered onto.
   * @param _options - Module options for this bot; read for `scenes.session`.
   */
  public constructor(
    private readonly _botName: string,
    private readonly _discovery: DiscoveryService,
    private readonly _scanner: MetadataScanner,
    private readonly _reflector: Reflector,
    private readonly _enhancers: TelegramEnhancerResolver,
    private readonly _bot: Telegraf,
    private readonly _options: TelegramBotModuleOptions,
  ) {
    this._logger = new Logger(
      _botName === DEFAULT_BOT_NAME
        ? TelegramBotScenesRegistrar.name
        : `${TelegramBotScenesRegistrar.name}[${_botName}]`,
    );
  }

  /**
   * Discovers this bot's scenes, builds them, and registers `session` + the
   * `Stage` middleware on the bot. A no-op (returns `false`) when no scenes
   * target this bot, so the `session`/`Stage` middleware is added only when it is
   * actually needed.
   *
   * @returns `true` when at least one scene was registered; otherwise `false`.
   * @throws {import('../../common').TelegramConfigError} If a scene's
   *   configuration is invalid (e.g. a wizard with no steps) or one of its
   *   enhancer class refs cannot be resolved from the DI container.
   */
  public register(): boolean {
    const scenes: Scenes.BaseScene<SceneFlowContext>[] = [];

    for (const wrapper of this._discovery.getProviders()) {
      const instance = wrapper.instance;
      const metatype = wrapper.metatype;
      if (!instance || typeof instance !== 'object' || !metatype) continue;

      // ── Only build classes explicitly marked with @Scene/@WizardScene. ──────
      const definition = this._reflector.get<SceneDefinition | undefined>(
        SCENE_DEFINITION_METADATA,
        metatype,
      );
      if (!definition) continue;

      // ── Scope to this registrar's bot (same rule as @TelegramUpdate). ───────
      if ((definition.bot ?? DEFAULT_BOT_NAME) !== this._botName) continue;

      const methods = this.collectSceneMethods(
        instance,
        metatype as Type,
        wrapper.name ?? metatype.name,
      );
      scenes.push(buildScene({ definition, methods }));
      this._logger.log(
        `Registered @${
          definition.kind === SCENE_KINDS.WIZARD ? 'WizardScene' : 'Scene'
        } "${definition.id}" → bot "${this._botName}".`,
      );
    }

    if (scenes.length === 0) return false;

    const stage = new Scenes.Stage<SceneFlowContext>(scenes);

    // ── Scenes require `ctx.session`; auto-register the in-memory session
    //    middleware unless the consumer opts out (they supply their own). ──────
    if (this._options.scenes?.session !== false)
      // session() infers the base Context; safe to register on the bot as-is.
      this._bot.use(session());

    // ── The Stage middleware augments the context with `scene`/`wizard`, which
    //    the library's generic-free `Telegraf` type cannot express statically;
    //    Telegraf populates them at runtime. Narrow the cast to a plain
    //    `MiddlewareFn<Context>` — the only contract `bot.use` requires. ───────
    this._bot.use(stage.middleware() as unknown as MiddlewareFn<Context>);

    return true;
  }

  /**
   * Harvests the decorated methods of one scene provider into the
   * {@link SceneMethodSpec}s {@link buildScene} consumes, resolving each method's
   * enhancers once and capturing a runner that dispatches through them.
   *
   * @param instance - The resolved scene provider instance.
   * @param metatype - The scene provider class (for enhancer + context metadata).
   * @param className - The provider's display name (for handler labels).
   * @returns One spec per method that declares any scene/message binding.
   * @throws {import('../../common').TelegramConfigError} If an enhancer class ref
   *   cannot be resolved from the DI container.
   */
  private collectSceneMethods(
    instance: object,
    metatype: Type,
    className: string,
  ): SceneMethodSpec[] {
    const specs: SceneMethodSpec[] = [];
    const prototype = Object.getPrototypeOf(instance) as object | null;
    if (!prototype) return specs;

    for (const methodName of this._scanner.getAllMethodNames(prototype)) {
      const method = (instance as Record<string, unknown>)[methodName];
      if (typeof method !== 'function') continue;
      const handler = method as TelegramUpdateHandler;

      const sceneBindings =
        this._reflector.get<SceneMethodBinding[]>(
          SCENE_METHOD_BINDINGS_METADATA,
          handler,
        ) ?? [];
      const updateBindings =
        this._reflector.get<UpdateBinding[]>(
          UPDATE_BINDINGS_METADATA,
          handler,
        ) ?? [];

      // ── A method matters only if it declares at least one binding. ──────────
      if (sceneBindings.length === 0 && updateBindings.length === 0) continue;

      const params =
        this._reflector.get<ParamMetadata[]>(
          UPDATE_PARAMS_METADATA,
          handler,
        ) ?? [];
      const label = `${className}.${methodName}`;
      const enhancers = this._enhancers.resolve(metatype, handler);

      specs.push({
        sceneBindings,
        updateBindings,
        label,
        run: async (ctx: Context): Promise<void> => {
          // ── Scene handlers are terminal here; ignore the proceed signal. ────
          await dispatchToHandler(
            { instance, metatype, handler, params, enhancers, label },
            ctx,
            this._logger,
          );
        },
      });
    }
    return specs;
  }
}
