/**
 * @file src/lib/bot/scenes/scene.types.ts
 *
 * PURPOSE
 * -------
 * Shared types and reflect-metadata keys for the Bot API **scene & wizard**
 * decorator system. A class wearing `@Scene(id)` / `@WizardScene(id)` carries a
 * {@link SceneDefinition} (its id, whether it is a plain scene or a wizard, and
 * the target bot); each decorated method carries zero or more
 * {@link SceneMethodBinding}s describing the scene lifecycle hook it implements
 * (`@SceneEnter`, `@SceneLeave`, `@WizardStep`). Within-scene message handlers
 * reuse the existing `@Command`/`@Hears`/`@Action`/`@On`/`@Use` decorators and
 * their {@link import('../updates/telegram-update.types').UpdateBinding}s, so
 * those are intentionally not redefined here.
 *
 * No `enum` is used anywhere — closed sets are modelled as `as const` records
 * plus derived union types (see CLAUDE.md).
 *
 * USAGE
 * -----
 * Internal to `src/lib/bot/scenes`; the public surface is the decorators that
 * produce these descriptors and the scenes registrar that consumes them.
 *
 * KEY EXPORTS
 * -----------
 * - SCENE_KINDS / SceneKind: plain scene vs wizard scene.
 * - SceneDefinition: the per-class descriptor recorded by `@Scene`/`@WizardScene`.
 * - SCENE_METHOD_KINDS / SceneMethodKind: the scene lifecycle hook kinds.
 * - SceneMethodBinding: a discriminated descriptor of one `@SceneEnter`/… binding.
 * - *_METADATA: reflect-metadata keys the scenes registrar reads.
 */

// ── Scene kinds ─────────────────────────────────────────────────────────────

/**
 * The closed set of scene flavours. A `SCENE` builds a Telegraf
 * `Scenes.BaseScene`; a `WIZARD` builds a `Scenes.WizardScene` with ordered
 * steps.
 */
export const SCENE_KINDS = {
  /** A plain scene (`@Scene`) — handlers fire while the scene is active. */
  SCENE: 'scene',
  /** A wizard scene (`@WizardScene`) — `@WizardStep`s run in cursor order. */
  WIZARD: 'wizard',
} as const;

/** A single scene flavour (the value side of {@link SCENE_KINDS}). */
export type SceneKind = (typeof SCENE_KINDS)[keyof typeof SCENE_KINDS];

/**
 * The per-class descriptor recorded by `@Scene(id)` / `@WizardScene(id)`. Read by
 * the scenes registrar to know the scene's id, flavour, and which bot to register
 * it on (multi-bot scoping mirrors `@TelegramUpdate({ bot })`).
 */
export interface SceneDefinition {
  /** The scene id used with `ctx.scene.enter(id)` and `Stage` registration. */
  readonly id: string;
  /** Whether this is a plain scene or a wizard. */
  readonly kind: SceneKind;
  /** Name of the bot this scene is registered on (defaults to the default bot). */
  readonly bot: string;
}

// ── Scene lifecycle method kinds ────────────────────────────────────────────

/**
 * The closed set of scene-lifecycle hooks a decorated method can implement. These
 * are distinct from the {@link import('../updates/telegram-update.types').BotUpdateKind}
 * message bindings (`command`/`hears`/…), which scenes reuse as-is.
 */
export const SCENE_METHOD_KINDS = {
  /** Runs when the scene is entered (`@SceneEnter` → `scene.enter`). */
  ENTER: 'enter',
  /** Runs when the scene is left (`@SceneLeave` → `scene.leave`). */
  LEAVE: 'leave',
  /** A wizard step at a 1-based cursor position (`@WizardStep(n)`). */
  STEP: 'step',
} as const;

/** A single scene-method kind (the value side of {@link SCENE_METHOD_KINDS}). */
export type SceneMethodKind =
  (typeof SCENE_METHOD_KINDS)[keyof typeof SCENE_METHOD_KINDS];

/**
 * Describes one scene-lifecycle binding produced by a scene method decorator.
 * `enter`/`leave` carry no extra data; a wizard `step` carries its 1-based
 * position so the registrar can order the steps it passes to `WizardScene`.
 */
export type SceneMethodBinding =
  | { readonly kind: typeof SCENE_METHOD_KINDS.ENTER }
  | { readonly kind: typeof SCENE_METHOD_KINDS.LEAVE }
  | {
      readonly kind: typeof SCENE_METHOD_KINDS.STEP;
      /** 1-based step position; steps run in ascending order of this value. */
      readonly step: number;
    };

// ── Reflect-metadata keys ───────────────────────────────────────────────────

/**
 * Holds the {@link SceneDefinition} recorded on a class by `@Scene` /
 * `@WizardScene`. Its presence is also the scan marker — only classes carrying it
 * are treated as scene providers by the registrar.
 */
export const SCENE_DEFINITION_METADATA = 'nestjs-telegram:scene-definition';

/** Holds the array of {@link SceneMethodBinding}s attached to a scene method. */
export const SCENE_METHOD_BINDINGS_METADATA =
  'nestjs-telegram:scene-method-bindings';
