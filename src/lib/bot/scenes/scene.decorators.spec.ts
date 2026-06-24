/**
 * @file src/lib/bot/scenes/scene.decorators.spec.ts
 *
 * PURPOSE
 * -------
 * Unit tests for the scene & wizard decorators: they must record the right
 * class-level {@link SceneDefinition} (id, kind, target bot) and append the
 * correct {@link SceneMethodBinding}s to each decorated method, preserving
 * stacked bindings. Pure reflect-metadata assertions — no bot, no network.
 */

import 'reflect-metadata';

import { DEFAULT_BOT_NAME } from '../telegram-bot.constants';
import {
  Scene,
  SceneEnter,
  SceneLeave,
  WizardScene,
  WizardStep,
} from './scene.decorators';
import {
  SCENE_DEFINITION_METADATA,
  SCENE_KINDS,
  SCENE_METHOD_BINDINGS_METADATA,
  SCENE_METHOD_KINDS,
  type SceneDefinition,
  type SceneMethodBinding,
} from './scene.types';

/** Reads the class-level scene definition recorded by `@Scene`/`@WizardScene`. */
function readDefinition(target: object): SceneDefinition | undefined {
  return Reflect.getMetadata(SCENE_DEFINITION_METADATA, target) as
    | SceneDefinition
    | undefined;
}

/** Reads the scene-method bindings recorded on a method by its decorators. */
function readBindings(
  proto: object,
  method: string,
): SceneMethodBinding[] | undefined {
  const fn = (proto as Record<string, unknown>)[method] as object;
  return Reflect.getMetadata(SCENE_METHOD_BINDINGS_METADATA, fn) as
    | SceneMethodBinding[]
    | undefined;
}

describe('scene class decorators', () => {
  it('@Scene records a plain-scene definition on the default bot', () => {
    @Scene('survey')
    class SurveyScene {}

    expect(readDefinition(SurveyScene)).toEqual({
      id: 'survey',
      kind: SCENE_KINDS.SCENE,
      bot: DEFAULT_BOT_NAME,
    });
  });

  it('@WizardScene records a wizard definition', () => {
    @WizardScene('signup')
    class SignupWizard {}

    expect(readDefinition(SignupWizard)).toEqual({
      id: 'signup',
      kind: SCENE_KINDS.WIZARD,
      bot: DEFAULT_BOT_NAME,
    });
  });

  it('scopes the scene to a named bot via options.bot', () => {
    @Scene('ticket', { bot: 'support' })
    class TicketScene {}

    expect(readDefinition(TicketScene)?.bot).toBe('support');
  });
});

describe('scene method decorators', () => {
  it('records enter/leave/step bindings on the right methods', () => {
    @WizardScene('signup')
    class SignupWizard {
      @SceneEnter()
      onEnter(): void {}
      @SceneLeave()
      onLeave(): void {}
      @WizardStep(1)
      stepOne(): void {}
      @WizardStep(2)
      stepTwo(): void {}
    }

    const proto = SignupWizard.prototype;
    expect(readBindings(proto, 'onEnter')).toEqual([
      { kind: SCENE_METHOD_KINDS.ENTER },
    ]);
    expect(readBindings(proto, 'onLeave')).toEqual([
      { kind: SCENE_METHOD_KINDS.LEAVE },
    ]);
    expect(readBindings(proto, 'stepOne')).toEqual([
      { kind: SCENE_METHOD_KINDS.STEP, step: 1 },
    ]);
    expect(readBindings(proto, 'stepTwo')).toEqual([
      { kind: SCENE_METHOD_KINDS.STEP, step: 2 },
    ]);
  });

  it('preserves stacked bindings on one method', () => {
    @Scene('combo')
    class ComboScene {
      @SceneEnter()
      @SceneLeave()
      both(): void {}
    }

    // ── Decorators apply bottom-up, so leave is appended before enter. ─────────
    expect(readBindings(ComboScene.prototype, 'both')).toEqual([
      { kind: SCENE_METHOD_KINDS.LEAVE },
      { kind: SCENE_METHOD_KINDS.ENTER },
    ]);
  });
});
