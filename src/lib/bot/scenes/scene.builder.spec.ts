/**
 * @file src/lib/bot/scenes/scene.builder.spec.ts
 *
 * PURPOSE
 * -------
 * Unit tests for the pure scene builder. They prove the structural shape of the
 * built scenes (a plain `@Scene` → `BaseScene`, a `@WizardScene` → `WizardScene`
 * with its steps in ascending order), that every binding kind is wired onto the
 * scene's `Composer` with the right trigger and runner, and that invalid wizard
 * configurations fail fast with a {@link TelegramConfigError}. No network: the
 * scenes are real Telegraf objects, and `Composer`/`BaseScene` methods are spied.
 */

import { Composer, Scenes, type Context } from 'telegraf';

import { TelegramConfigError } from '../../common';
import { BOT_UPDATE_KINDS } from '../updates/telegram-update.types';
import {
  buildScene,
  type SceneMethodSpec,
  type SceneRunner,
} from './scene.builder';
import {
  SCENE_KINDS,
  SCENE_METHOD_KINDS,
  type SceneDefinition,
} from './scene.types';

/** A no-op runner that records each context it is invoked with. */
function recordingRunner(): SceneRunner & { calls: Context[] } {
  const calls: Context[] = [];
  const run = ((ctx: Context) => {
    calls.push(ctx);
    return Promise.resolve();
  }) as SceneRunner & { calls: Context[] };
  run.calls = calls;
  return run;
}

/** Builds a {@link SceneMethodSpec} with sensible empty defaults. */
function methodSpec(partial: Partial<SceneMethodSpec>): SceneMethodSpec {
  return {
    updateBindings: partial.updateBindings ?? [],
    sceneBindings: partial.sceneBindings ?? [],
    run: partial.run ?? (() => Promise.resolve()),
    label: partial.label ?? 'Test.method',
  };
}

/** A plain-scene definition for the given id. */
function sceneDef(id: string): SceneDefinition {
  return { id, kind: SCENE_KINDS.SCENE, bot: 'default' };
}

/** A wizard-scene definition for the given id. */
function wizardDef(id: string): SceneDefinition {
  return { id, kind: SCENE_KINDS.WIZARD, bot: 'default' };
}

/** A minimal fake context for driving captured handler callbacks. */
function fakeContext(): Context {
  return {} as unknown as Context;
}

describe('buildScene — structure', () => {
  it('builds a BaseScene for a plain @Scene', () => {
    const scene = buildScene({ definition: sceneDef('survey'), methods: [] });

    expect(scene).toBeInstanceOf(Scenes.BaseScene);
    expect(scene).not.toBeInstanceOf(Scenes.WizardScene);
    expect(scene.id).toBe('survey');
  });

  it('builds a WizardScene whose steps run in ascending position order', async () => {
    const first = recordingRunner();
    const second = recordingRunner();
    // ── Declared out of order (2 before 1) to prove the builder sorts. ─────────
    const scene = buildScene({
      definition: wizardDef('signup'),
      methods: [
        methodSpec({
          sceneBindings: [{ kind: SCENE_METHOD_KINDS.STEP, step: 2 }],
          run: second,
          label: 'W.second',
        }),
        methodSpec({
          sceneBindings: [{ kind: SCENE_METHOD_KINDS.STEP, step: 1 }],
          run: first,
          label: 'W.first',
        }),
      ],
    });

    expect(scene).toBeInstanceOf(Scenes.WizardScene);
    const wizard = scene as Scenes.WizardScene<Scenes.WizardContext>;
    expect(wizard.steps).toHaveLength(2);

    const ctx = fakeContext();
    const next = (): Promise<void> => Promise.resolve();
    // ── steps[0] must be the step declared at position 1. ──────────────────────
    await (wizard.steps[0] as (c: Context, n: () => Promise<void>) => unknown)(
      ctx,
      next,
    );
    expect(first.calls).toHaveLength(1);
    expect(second.calls).toHaveLength(0);
  });
});

describe('buildScene — binding wiring', () => {
  afterEach(() => jest.restoreAllMocks());

  it('wires @SceneEnter/@SceneLeave onto enter()/leave()', async () => {
    const enterSpy = jest
      .spyOn(Scenes.BaseScene.prototype, 'enter')
      .mockReturnThis();
    const leaveSpy = jest
      .spyOn(Scenes.BaseScene.prototype, 'leave')
      .mockReturnThis();
    const enter = recordingRunner();
    const leave = recordingRunner();

    buildScene({
      definition: sceneDef('s'),
      methods: [
        methodSpec({
          sceneBindings: [{ kind: SCENE_METHOD_KINDS.ENTER }],
          run: enter,
        }),
        methodSpec({
          sceneBindings: [{ kind: SCENE_METHOD_KINDS.LEAVE }],
          run: leave,
        }),
      ],
    });

    // ── Each captured callback must invoke its runner with the update ctx. ─────
    const ctx = fakeContext();
    await (enterSpy.mock.calls[0]?.[0] as unknown as SceneRunner)(ctx);
    await (leaveSpy.mock.calls[0]?.[0] as unknown as SceneRunner)(ctx);
    expect(enter.calls).toEqual([ctx]);
    expect(leave.calls).toEqual([ctx]);
  });

  it('maps every message binding kind onto the matching Composer method', async () => {
    const command = jest
      .spyOn(Composer.prototype, 'command')
      .mockReturnThis();
    const hears = jest.spyOn(Composer.prototype, 'hears').mockReturnThis();
    const action = jest.spyOn(Composer.prototype, 'action').mockReturnThis();
    const on = jest.spyOn(Composer.prototype, 'on').mockReturnThis();
    const start = jest.spyOn(Composer.prototype, 'start').mockReturnThis();
    const help = jest.spyOn(Composer.prototype, 'help').mockReturnThis();
    const use = jest.spyOn(Composer.prototype, 'use').mockReturnThis();
    const run = recordingRunner();

    buildScene({
      definition: sceneDef('s'),
      methods: [
        methodSpec({
          run,
          updateBindings: [
            { kind: BOT_UPDATE_KINDS.START },
            { kind: BOT_UPDATE_KINDS.HELP },
            { kind: BOT_UPDATE_KINDS.COMMAND, trigger: 'quit' },
            { kind: BOT_UPDATE_KINDS.HEARS, trigger: 'again' },
            { kind: BOT_UPDATE_KINDS.ACTION, trigger: 'go' },
            { kind: BOT_UPDATE_KINDS.ON, trigger: 'text' },
            { kind: BOT_UPDATE_KINDS.USE },
          ],
        }),
      ],
    });

    expect(command).toHaveBeenCalledWith('quit', expect.any(Function));
    expect(hears).toHaveBeenCalledWith('again', expect.any(Function));
    expect(action).toHaveBeenCalledWith('go', expect.any(Function));
    expect(on).toHaveBeenCalledWith('text', expect.any(Function));
    expect(start).toHaveBeenCalledWith(expect.any(Function));
    expect(help).toHaveBeenCalledWith(expect.any(Function));
    expect(use).toHaveBeenCalledWith(expect.any(Function));

    // ── The terminal callbacks invoke the runner with the update context. ─────
    const ctx = fakeContext();
    await (command.mock.calls[0]?.[1] as unknown as SceneRunner)(ctx);
    expect(run.calls).toEqual([ctx]);

    // ── The @Use() callback runs the handler, then continues the chain. ───────
    const next = jest.fn().mockResolvedValue(undefined);
    await (
      use.mock.calls[0]?.[0] as unknown as (
        c: Context,
        n: () => Promise<void>,
      ) => Promise<void>
    )(ctx, next);
    expect(run.calls).toHaveLength(2);
    expect(next).toHaveBeenCalledTimes(1);
  });
});

describe('buildScene — validation', () => {
  it('rejects a wizard with no steps', () => {
    expect(() =>
      buildScene({ definition: wizardDef('empty'), methods: [] }),
    ).toThrow(TelegramConfigError);
  });

  it('rejects @WizardStep on a plain @Scene', () => {
    expect(() =>
      buildScene({
        definition: sceneDef('plain'),
        methods: [
          methodSpec({
            sceneBindings: [{ kind: SCENE_METHOD_KINDS.STEP, step: 1 }],
          }),
        ],
      }),
    ).toThrow(/only valid inside a @WizardScene/);
  });

  it('rejects duplicate step positions', () => {
    expect(() =>
      buildScene({
        definition: wizardDef('dup'),
        methods: [
          methodSpec({
            sceneBindings: [{ kind: SCENE_METHOD_KINDS.STEP, step: 1 }],
            label: 'W.a',
          }),
          methodSpec({
            sceneBindings: [{ kind: SCENE_METHOD_KINDS.STEP, step: 1 }],
            label: 'W.b',
          }),
        ],
      }),
    ).toThrow(/each step position must be unique/);
  });

  it('rejects a non-positive or non-integer step position', () => {
    expect(() =>
      buildScene({
        definition: wizardDef('bad'),
        methods: [
          methodSpec({
            sceneBindings: [{ kind: SCENE_METHOD_KINDS.STEP, step: 0 }],
          }),
        ],
      }),
    ).toThrow(/positions must be integers/);
  });
});
