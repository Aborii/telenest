/**
 * @file src/lib/bot/scenes/scene.decorators.ts
 *
 * PURPOSE
 * -------
 * The class and method decorators that make a NestJS provider a first-class
 * Telegraf **scene** or **wizard**. `@Scene(id)` / `@WizardScene(id)` mark the
 * class so the scenes registrar discovers it and builds the matching Telegraf
 * `Scenes.BaseScene` / `Scenes.WizardScene`; the method decorators record the
 * lifecycle hook each method implements (`@SceneEnter`, `@SceneLeave`,
 * `@WizardStep`). Within-scene message handlers reuse the existing
 * `@Command`/`@Hears`/`@Action`/`@On`/`@Use`/`@Start`/`@Help` decorators, the
 * same param decorators (`@Ctx`, `@MessageText`, …), and the same enhancer stack
 * (`@UseTelegramGuards`/…) as top-level update handlers.
 *
 * USAGE
 * -----
 * ```ts
 * @Scene('survey')
 * export class SurveyScene {
 *   @SceneEnter() onEnter(@Ctx() ctx: Context) { return ctx.reply('Welcome!'); }
 *   @Hears('again') onAgain(@Ctx() ctx: Context) { return ctx.reply('Again!'); }
 *   @Command('quit') onQuit(@Ctx() ctx: SceneContext) { return ctx.scene.leave(); }
 * }
 *
 * @WizardScene('signup')
 * export class SignupWizard {
 *   @WizardStep(1) askName(@Ctx() ctx: WizardContext) { ... ctx.wizard.next(); }
 *   @WizardStep(2) saveName(@Ctx() ctx: WizardContext) { ... ctx.scene.leave(); }
 * }
 *
 * // Scope a scene to a named bot (multi-bot apps):
 * @Scene('ticket', { bot: 'support' })
 * export class TicketScene { ... }
 * ```
 *
 * KEY EXPORTS
 * -----------
 * - Scene: class decorator marking a plain scene provider.
 * - WizardScene: class decorator marking a wizard scene provider.
 * - SceneOptions: options accepted by `@Scene` / `@WizardScene`.
 * - SceneEnter / SceneLeave: scene-lifecycle method decorators.
 * - WizardStep: wizard step method decorator (1-based position).
 */

import 'reflect-metadata';

import { SetMetadata } from '@nestjs/common';

import { DEFAULT_BOT_NAME } from '../telegram-bot.constants';
import {
  SCENE_DEFINITION_METADATA,
  SCENE_KINDS,
  SCENE_METHOD_BINDINGS_METADATA,
  SCENE_METHOD_KINDS,
  type SceneKind,
  type SceneMethodBinding,
} from './scene.types';

/**
 * Appends a {@link SceneMethodBinding} to a scene method's metadata, preserving
 * any bindings added by other stacked decorators on the same method.
 *
 * @param target - The prototype carrying the method (decorator `target`).
 * @param propertyKey - The decorated method's name.
 * @param binding - The lifecycle binding descriptor to record.
 * @returns Nothing.
 * @throws Never.
 */
function appendSceneBinding(
  target: object,
  propertyKey: string | symbol,
  binding: SceneMethodBinding,
): void {
  // ── Metadata is attached to the method function itself — the same reference
  //    the scenes registrar later reads off the resolved instance. ────────────
  const method = (target as Record<string | symbol, unknown>)[propertyKey] as
    | object
    | undefined;
  if (!method) return;

  const existing =
    (Reflect.getMetadata(SCENE_METHOD_BINDINGS_METADATA, method) as
      | SceneMethodBinding[]
      | undefined) ?? [];
  Reflect.defineMetadata(
    SCENE_METHOD_BINDINGS_METADATA,
    [...existing, binding],
    method,
  );
}

/** Options for the {@link Scene} and {@link WizardScene} class decorators. */
export interface SceneOptions {
  /**
   * Name of the registered bot this scene is registered on. Must match the
   * `name` passed to the corresponding `TelegramBotModule.forRoot({ name })`.
   * Omit (or pass the default bot name) to register on the default bot. Mirrors
   * `@TelegramUpdate({ bot })` so a scene lives on exactly one bot.
   */
  readonly bot?: string;
}

/**
 * Records the class-level {@link import('./scene.types').SceneDefinition} that
 * marks a provider as a scene of the given flavour and binds it to a bot.
 *
 * @param id - The scene id (used with `ctx.scene.enter(id)`).
 * @param kind - Plain scene or wizard.
 * @param options - Optional settings; `bot` scopes the scene to a named bot.
 * @returns A class decorator attaching the scene definition metadata.
 * @throws Never.
 */
function defineScene(
  id: string,
  kind: SceneKind,
  options?: SceneOptions,
): ClassDecorator {
  const bot = options?.bot ?? DEFAULT_BOT_NAME;
  return (target) => {
    SetMetadata(SCENE_DEFINITION_METADATA, { id, kind, bot })(target);
  };
}

/**
 * Marks a class as a plain Telegraf scene. The scenes registrar builds a
 * `Scenes.BaseScene` for it, wires its `@SceneEnter`/`@SceneLeave` and message
 * handlers, and registers it on the scene `Stage`.
 *
 * @param id - The scene id used with `ctx.scene.enter(id)`.
 * @param options - Optional settings; `bot` scopes the scene to a named bot.
 * @returns A class decorator marking the scene provider.
 * @throws Never.
 *
 * @example
 * ```ts
 * @Scene('survey')
 * export class SurveyScene {
 *   @SceneEnter() onEnter(@Ctx() ctx: Context) { return ctx.reply('Welcome!'); }
 * }
 * ```
 */
export function Scene(id: string, options?: SceneOptions): ClassDecorator {
  return defineScene(id, SCENE_KINDS.SCENE, options);
}

/**
 * Marks a class as a Telegraf wizard scene. The scenes registrar builds a
 * `Scenes.WizardScene` whose steps are this class's `@WizardStep`-decorated
 * methods in ascending step order, plus any `@SceneEnter`/`@SceneLeave` and
 * message handlers.
 *
 * @param id - The scene id used with `ctx.scene.enter(id)`.
 * @param options - Optional settings; `bot` scopes the wizard to a named bot.
 * @returns A class decorator marking the wizard provider.
 * @throws Never.
 *
 * @example
 * ```ts
 * @WizardScene('signup')
 * export class SignupWizard {
 *   @WizardStep(1) askName(@Ctx() ctx: WizardContext) { ctx.wizard.next(); }
 *   @WizardStep(2) saveName(@Ctx() ctx: WizardContext) { ctx.scene.leave(); }
 * }
 * ```
 */
export function WizardScene(
  id: string,
  options?: SceneOptions,
): ClassDecorator {
  return defineScene(id, SCENE_KINDS.WIZARD, options);
}

/**
 * Marks a method as the scene's enter handler (binds to `scene.enter`). Runs once
 * each time the scene is entered. Multiple `@SceneEnter` methods are all bound.
 *
 * @returns A method decorator recording the binding.
 * @throws Never.
 */
export function SceneEnter(): MethodDecorator {
  return (target, propertyKey) =>
    appendSceneBinding(target, propertyKey, {
      kind: SCENE_METHOD_KINDS.ENTER,
    });
}

/**
 * Marks a method as the scene's leave handler (binds to `scene.leave`). Runs once
 * each time the scene is left. Multiple `@SceneLeave` methods are all bound.
 *
 * @returns A method decorator recording the binding.
 * @throws Never.
 */
export function SceneLeave(): MethodDecorator {
  return (target, propertyKey) =>
    appendSceneBinding(target, propertyKey, {
      kind: SCENE_METHOD_KINDS.LEAVE,
    });
}

/**
 * Marks a method as a wizard step at a 1-based position. The scenes registrar
 * orders every `@WizardStep` method on a `@WizardScene` by `step` ascending and
 * passes them to `Scenes.WizardScene` as its steps. Advance with
 * `ctx.wizard.next()` / `ctx.wizard.back()`, or finish with `ctx.scene.leave()`.
 *
 * Only valid inside a `@WizardScene`; using it on a plain `@Scene`, or declaring
 * two steps with the same position, fails fast at bootstrap with a
 * {@link import('../../common').TelegramConfigError}.
 *
 * @param step - The 1-based step position (a positive integer).
 * @returns A method decorator recording the binding.
 * @throws Never (invalid positions are reported by the registrar at bootstrap).
 *
 * @example
 * ```ts
 * @WizardStep(1)
 * askName(@Ctx() ctx: WizardContext) { ctx.wizard.next(); }
 * ```
 */
export function WizardStep(step: number): MethodDecorator {
  return (target, propertyKey) =>
    appendSceneBinding(target, propertyKey, {
      kind: SCENE_METHOD_KINDS.STEP,
      step,
    });
}
