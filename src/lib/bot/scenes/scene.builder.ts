/**
 * @file src/lib/bot/scenes/scene.builder.ts
 *
 * PURPOSE
 * -------
 * Pure (DI-free, network-free) construction of a Telegraf `Scenes.BaseScene` /
 * `Scenes.WizardScene` from the metadata harvested off a `@Scene`/`@WizardScene`
 * provider. The scenes registrar resolves each method's runner (its enhancer
 * pipeline + argument resolution) and its bindings, then hands them here as a
 * {@link SceneSpec}; this module wires the enter/leave hooks, the within-scene
 * message handlers, and (for wizards) the ordered steps onto a concrete scene.
 *
 * Keeping the construction here — separate from discovery and DI — makes the
 * validation rules (a wizard needs steps, a plain scene may not use `@WizardStep`,
 * step positions must be unique) trivially unit-testable without a running bot.
 *
 * USAGE
 * -----
 * Internal to `src/lib/bot/scenes`. The registrar is the only caller.
 *
 * KEY EXPORTS
 * -----------
 * - SceneFlowContext: the Telegraf context type the built scenes are typed for.
 * - SceneRunner: a resolved handler ready to run against an update context.
 * - SceneMethodSpec / SceneSpec: the inputs the registrar assembles per scene.
 * - buildScene: turn a `SceneSpec` into a configured `BaseScene`/`WizardScene`.
 */

import { Composer, Scenes, type Context } from 'telegraf';

import { TelegramConfigError } from '../../common';
import {
  BOT_UPDATE_KINDS,
  type UpdateBinding,
} from '../updates/telegram-update.types';
import {
  SCENE_KINDS,
  SCENE_METHOD_KINDS,
  type SceneDefinition,
  type SceneMethodBinding,
} from './scene.types';

/**
 * The Telegraf context the built scenes are typed against. Telegraf's
 * `WizardContext` carries `session`, `scene`, and `wizard`, so it satisfies the
 * generic constraints of both `Scenes.BaseScene`, `Scenes.WizardScene`, and
 * `Scenes.Stage` — a single context type for the whole scene subsystem. (A
 * consumer's own handler may declare a narrower or custom context; the runner is
 * context-agnostic and only reads through the base `Context`.)
 */
export type SceneFlowContext = Scenes.WizardContext;

/**
 * A resolved scene handler: maps the current update {@link Context} to a settled
 * promise. Produced by the registrar (enhancer pipeline + argument resolution)
 * and bound onto the scene by {@link buildScene}. Typed against the base
 * {@link Context} so it is assignable wherever a `Middleware<SceneFlowContext>`
 * is expected (a wider context parameter is contravariantly compatible).
 */
export type SceneRunner = (ctx: Context) => Promise<void>;

/**
 * One discovered scene method: the within-scene message bindings it declares via
 * the reused `@Command`/`@Hears`/… decorators, the scene-lifecycle bindings it
 * declares via `@SceneEnter`/`@SceneLeave`/`@WizardStep`, and the resolved runner
 * that invokes it.
 */
export interface SceneMethodSpec {
  /** Message bindings (`command`/`hears`/`action`/`on`/`use`/`start`/`help`). */
  readonly updateBindings: readonly UpdateBinding[];
  /** Scene-lifecycle bindings (`enter`/`leave`/`step`). */
  readonly sceneBindings: readonly SceneMethodBinding[];
  /** The resolved handler to run when any of this method's bindings fire. */
  readonly run: SceneRunner;
  /** Human-readable identifier (`Class.method`) for error messages. */
  readonly label: string;
}

/** Everything {@link buildScene} needs to construct one scene. */
export interface SceneSpec {
  /** The class-level scene descriptor (id, kind, bot). */
  readonly definition: SceneDefinition;
  /** The decorated methods discovered on the provider. */
  readonly methods: readonly SceneMethodSpec[];
}

/** A resolved wizard step paired with its 1-based position (for ordering). */
interface WizardStepEntry {
  /** 1-based step position from `@WizardStep(n)`. */
  readonly step: number;
  /** The runner invoked when the wizard cursor reaches this step. */
  readonly run: SceneRunner;
  /** Identifier for duplicate-position error messages. */
  readonly label: string;
}

/**
 * Binds one reused message {@link UpdateBinding} onto a scene's `Composer`. Both
 * `Telegraf` and `Scenes.BaseScene` extend `Composer`, so the same `kind →
 * method` mapping the top-level registrar uses applies verbatim inside a scene.
 * Matched handlers are terminal; `@Use()` continues the chain with `next`.
 *
 * @param composer - The scene (a `Composer`) to register the handler on.
 * @param binding - The message binding to apply.
 * @param run - The resolved runner to invoke when the binding fires.
 * @returns Nothing.
 * @throws Never.
 */
function bindMessageHandler(
  composer: Composer<Context>,
  binding: UpdateBinding,
  run: SceneRunner,
): void {
  switch (binding.kind) {
    case BOT_UPDATE_KINDS.START:
      composer.start((ctx: Context) => run(ctx));
      break;
    case BOT_UPDATE_KINDS.HELP:
      composer.help((ctx: Context) => run(ctx));
      break;
    case BOT_UPDATE_KINDS.COMMAND:
      composer.command(binding.trigger, (ctx: Context) => run(ctx));
      break;
    case BOT_UPDATE_KINDS.HEARS:
      composer.hears(binding.trigger, (ctx: Context) => run(ctx));
      break;
    case BOT_UPDATE_KINDS.ACTION:
      composer.action(binding.trigger, (ctx: Context) => run(ctx));
      break;
    case BOT_UPDATE_KINDS.ON:
      composer.on(binding.trigger, (ctx: Context) => run(ctx));
      break;
    case BOT_UPDATE_KINDS.USE:
      composer.use(async (ctx: Context, next: () => Promise<void>) => {
        await run(ctx);
        await next();
      });
      break;
    default: {
      // ── Exhaustiveness guard: an unhandled kind fails to compile. ───────────
      const exhaustive: never = binding;
      return exhaustive;
    }
  }
}

/**
 * Applies the shared bindings (enter/leave hooks and within-scene message
 * handlers) that both plain scenes and wizards support onto a built scene.
 *
 * @param scene - The constructed scene to configure.
 * @param methods - The discovered scene methods.
 * @returns Nothing.
 * @throws Never.
 */
function applyCommonBindings(
  scene: Scenes.BaseScene<SceneFlowContext>,
  methods: readonly SceneMethodSpec[],
): void {
  // ── BaseScene extends Composer, so reuse the top-level kind→method mapping. ─
  const composer = scene as unknown as Composer<Context>;
  for (const method of methods) {
    for (const binding of method.sceneBindings) {
      if (binding.kind === SCENE_METHOD_KINDS.ENTER)
        scene.enter((ctx: Context) => method.run(ctx));
      else if (binding.kind === SCENE_METHOD_KINDS.LEAVE)
        scene.leave((ctx: Context) => method.run(ctx));
      // STEP bindings are wired by the wizard builder, not here.
    }
    for (const binding of method.updateBindings)
      bindMessageHandler(composer, binding, method.run);
  }
}

/**
 * Collects, validates, and orders the wizard steps declared across a wizard's
 * methods. Steps run in ascending position order.
 *
 * @param methods - The discovered scene methods.
 * @param sceneId - The scene id, used in error messages.
 * @returns The runners in step order (index 0 = lowest step number).
 * @throws {TelegramConfigError} If there are no steps, a position is not a
 *   positive integer, or two methods declare the same position.
 */
function collectWizardSteps(
  methods: readonly SceneMethodSpec[],
  sceneId: string,
): SceneRunner[] {
  const entries: WizardStepEntry[] = [];
  for (const method of methods)
    for (const binding of method.sceneBindings)
      if (binding.kind === SCENE_METHOD_KINDS.STEP) {
        if (!Number.isInteger(binding.step) || binding.step < 1)
          throw new TelegramConfigError(
            `@WizardStep at ${method.label} has an invalid position ${binding.step}; ` +
              'step positions must be integers ≥ 1.',
          );
        entries.push({
          step: binding.step,
          run: method.run,
          label: method.label,
        });
      }

  if (entries.length === 0)
    throw new TelegramConfigError(
      `@WizardScene "${sceneId}" declares no @WizardStep methods; a wizard needs at least one step.`,
    );

  // ── Reject duplicate positions: ambiguous step order is a configuration bug. ─
  const seen = new Map<number, string>();
  for (const entry of entries) {
    const previous = seen.get(entry.step);
    if (previous !== undefined)
      throw new TelegramConfigError(
        `@WizardScene "${sceneId}" has two methods at step ${entry.step} ` +
          `(${previous} and ${entry.label}); each step position must be unique.`,
      );
    seen.set(entry.step, entry.label);
  }

  return [...entries]
    .sort((a, b) => a.step - b.step)
    .map((entry) => entry.run);
}

/**
 * Rejects `@WizardStep` declarations on a plain `@Scene` — steps are only
 * meaningful for a wizard.
 *
 * @param methods - The discovered scene methods.
 * @param sceneId - The scene id, used in the error message.
 * @returns Nothing.
 * @throws {TelegramConfigError} If any method declares a `step` binding.
 */
function assertNoWizardSteps(
  methods: readonly SceneMethodSpec[],
  sceneId: string,
): void {
  for (const method of methods)
    for (const binding of method.sceneBindings)
      if (binding.kind === SCENE_METHOD_KINDS.STEP)
        throw new TelegramConfigError(
          `@WizardStep at ${method.label} is only valid inside a @WizardScene; ` +
            `scene "${sceneId}" is a plain @Scene. Use @WizardScene, or remove @WizardStep.`,
        );
}

/**
 * Builds a configured Telegraf scene from a {@link SceneSpec}. A `SCENE` kind
 * yields a `Scenes.BaseScene`; a `WIZARD` kind yields a `Scenes.WizardScene`
 * whose steps are the `@WizardStep` methods in ascending order. Both flavours get
 * their `@SceneEnter`/`@SceneLeave` hooks and within-scene message handlers wired.
 *
 * @param spec - The scene definition plus its discovered methods + runners.
 * @returns The constructed, fully-wired scene.
 * @throws {TelegramConfigError} On invalid wizard configuration (see
 *   {@link collectWizardSteps} / {@link assertNoWizardSteps}).
 *
 * @example
 * ```ts
 * const scene = buildScene({ definition, methods });
 * stage.register(scene);
 * ```
 */
export function buildScene(spec: SceneSpec): Scenes.BaseScene<SceneFlowContext> {
  const { definition, methods } = spec;

  if (definition.kind === SCENE_KINDS.WIZARD) {
    const steps = collectWizardSteps(methods, definition.id);
    const wizard = new Scenes.WizardScene<SceneFlowContext>(
      definition.id,
      ...steps.map((run) => (ctx: Context) => run(ctx)),
    );
    applyCommonBindings(wizard, methods);
    return wizard;
  }

  assertNoWizardSteps(methods, definition.id);
  const scene = new Scenes.BaseScene<SceneFlowContext>(definition.id);
  applyCommonBindings(scene, methods);
  return scene;
}
