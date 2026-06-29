/**
 * @file src/lib/bot/scenes/telegram-bot-scenes.registrar.spec.ts
 *
 * PURPOSE
 * -------
 * Tests the scenes registrar at two levels. The *registration* suite proves the
 * mechanics over a recording `bot.use`: scenes are discovered and scoped to the
 * right bot, the `session` + `Stage` middleware is registered (and the session
 * layer can be opted out of), and no middleware is added when a bot has no
 * scenes. The *end-to-end* suite drives a **real** Telegraf instance via
 * `handleUpdate` (no network — handlers only record state, never call the Bot
 * API) to prove the full path: scene enter/leave, within-scene message handlers,
 * wizard step progression, param injection, and that the enhancer stack (a guard)
 * runs inside a scene.
 */

import { Injectable, type CanActivate } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import type { Telegraf } from 'telegraf';
import type { Update, UserFromGetMe } from 'telegraf/types';

import { TELEGRAM_BOT } from '../telegram-bot.constants';
import { TelegramBotModule } from '../telegram-bot.module';
import {
  getBotInstanceToken,
  getBotScenesRegistrarToken,
} from '../telegram-bot.tokens';
import { UseTelegramGuards } from '../updates/execution/enhancer.decorators';
import { Ctx, MessageText, Sender } from '../updates/param.decorators';
import { TelegramBotUpdatesRegistrar } from '../updates/telegram-bot-updates.registrar';
import {
  Command,
  Hears,
  TelegramUpdate,
} from '../updates/telegram-update.decorator';
import type { SceneFlowContext } from './scene.builder';
import {
  Scene,
  SceneEnter,
  SceneLeave,
  WizardScene,
  WizardStep,
} from './scene.decorators';
import { TelegramBotScenesRegistrar } from './telegram-bot-scenes.registrar';

// ── Test providers ──────────────────────────────────────────────────────────

/** Enters scenes/wizards on command (the only top-level update provider). */
@TelegramUpdate()
@Injectable()
class EntryUpdate {
  @Command('enter')
  async enter(@Ctx() ctx: SceneFlowContext): Promise<void> {
    await ctx.scene.enter('survey');
  }

  @Command('signup')
  async signup(@Ctx() ctx: SceneFlowContext): Promise<void> {
    await ctx.scene.enter('wiz');
  }

  @Command('guard')
  async guard(@Ctx() ctx: SceneFlowContext): Promise<void> {
    await ctx.scene.enter('guarded');
  }
}

/** A plain scene exercising enter/leave + within-scene message handlers. */
@Scene('survey')
@Injectable()
class SurveyScene {
  /** Ordered record of the lifecycle/message events that fired. */
  public readonly events: string[] = [];
  /** The sender injected into the enter handler via `@Sender()`. */
  public sender: unknown;

  @SceneEnter()
  onEnter(@Sender() from: unknown): void {
    this.events.push('enter');
    this.sender = from;
  }

  @Hears('again')
  onAgain(): void {
    this.events.push('again');
  }

  @Command('quit')
  async onQuit(@Ctx() ctx: SceneFlowContext): Promise<void> {
    this.events.push('quit');
    await ctx.scene.leave();
  }

  @SceneLeave()
  onLeave(): void {
    this.events.push('leave');
  }
}

/** A two-step wizard collecting a name. */
@WizardScene('wiz')
@Injectable()
class SignupWizard {
  /** Ordered record of the steps that ran. */
  public readonly steps: string[] = [];
  /** The text captured by the second step via `@MessageText()`. */
  public name: string | undefined;

  @WizardStep(1)
  askName(@Ctx() ctx: SceneFlowContext): void {
    this.steps.push('ask');
    ctx.wizard.next();
  }

  @WizardStep(2)
  async saveName(
    @MessageText() text: string | undefined,
    @Ctx() ctx: SceneFlowContext,
  ): Promise<void> {
    this.steps.push('save');
    this.name = text;
    await ctx.scene.leave();
  }
}

/** A guard that always denies, to prove the enhancer stack runs inside a scene. */
@Injectable()
class DenyGuard implements CanActivate {
  canActivate(): boolean {
    return false;
  }
}

/** A scene whose enter handler is gated by a denying guard. */
@Scene('guarded')
@Injectable()
class GuardedScene {
  /** Set true only if the (guarded) enter handler runs. */
  public entered = false;

  @SceneEnter()
  @UseTelegramGuards(DenyGuard)
  onEnter(): void {
    this.entered = true;
  }
}

/** A scene registered on a named bot, to prove multi-bot scoping. */
@Scene('notify-scene', { bot: 'notify' })
@Injectable()
class NotifyScene {
  @SceneEnter()
  onEnter(): void {}
}

// ── Helpers ───────────────────────────────────────────────────────────────

/** A well-formed bot identity so Telegraf can parse `/command` updates. */
const BOT_INFO: UserFromGetMe = {
  id: 42,
  is_bot: true,
  first_name: 'Test',
  username: 'testbot',
  can_join_groups: true,
  can_read_all_group_messages: false,
  supports_inline_queries: false,
};

describe('TelegramBotScenesRegistrar — registration', () => {
  afterEach(() => jest.restoreAllMocks());

  /** Replaces `bot.use` with a recording mock and returns it. */
  function recordUse(bot: Telegraf): jest.Mock {
    const useMock = jest.fn().mockReturnValue(bot);
    // ── Own-property shadow of the inherited Composer.use, scoped to this bot. ─
    bot.use = useMock as unknown as typeof bot.use;
    return useMock;
  }

  it('registers session + Stage middleware when scenes are present', async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [TelegramBotModule.forRoot({ token: '123:abc', launch: false })],
      providers: [SurveyScene],
    }).compile();

    const useMock = recordUse(moduleRef.get<Telegraf>(TELEGRAM_BOT));
    const scenes = moduleRef.get(TelegramBotScenesRegistrar, { strict: false });

    expect(scenes.register()).toBe(true);
    expect(useMock).toHaveBeenCalledTimes(2);
  });

  it('skips the session layer when scenes.session is false', async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [
        TelegramBotModule.forRoot({
          token: '123:abc',
          launch: false,
          scenes: { session: false },
        }),
      ],
      providers: [SurveyScene],
    }).compile();

    const useMock = recordUse(moduleRef.get<Telegraf>(TELEGRAM_BOT));
    const scenes = moduleRef.get(TelegramBotScenesRegistrar, { strict: false });

    expect(scenes.register()).toBe(true);
    // ── Only the Stage middleware; the session middleware is the consumer's. ──
    expect(useMock).toHaveBeenCalledTimes(1);
  });

  it('registers nothing when the bot has no scenes', async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [TelegramBotModule.forRoot({ token: '123:abc', launch: false })],
      providers: [EntryUpdate],
    }).compile();

    const useMock = recordUse(moduleRef.get<Telegraf>(TELEGRAM_BOT));
    const scenes = moduleRef.get(TelegramBotScenesRegistrar, { strict: false });

    expect(scenes.register()).toBe(false);
    expect(useMock).not.toHaveBeenCalled();
  });

  it('scopes scenes to their target bot in a multi-bot app', async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [
        TelegramBotModule.forRoot({ token: '1:a', launch: false }),
        TelegramBotModule.forRoot({
          name: 'notify',
          token: '2:b',
          launch: false,
        }),
      ],
      providers: [NotifyScene],
    }).compile();

    const defaultUse = recordUse(moduleRef.get<Telegraf>(TELEGRAM_BOT));
    const notifyUse = recordUse(
      moduleRef.get<Telegraf>(getBotInstanceToken('notify'), { strict: false }),
    );
    const defaultScenes = moduleRef.get(TelegramBotScenesRegistrar, {
      strict: false,
    });
    const notifyScenes = moduleRef.get<TelegramBotScenesRegistrar>(
      getBotScenesRegistrarToken('notify'),
      { strict: false },
    );

    expect(notifyScenes.register()).toBe(true);
    expect(notifyUse).toHaveBeenCalledTimes(2);
    expect(defaultScenes.register()).toBe(false);
    expect(defaultUse).not.toHaveBeenCalled();
  });
});

describe('TelegramBotScenesRegistrar — end-to-end (real Telegraf)', () => {
  let bot: Telegraf;
  let survey: SurveyScene;
  let wizard: SignupWizard;
  let guarded: GuardedScene;
  let updateId = 0;

  beforeEach(async () => {
    updateId = 0;
    const moduleRef = await Test.createTestingModule({
      imports: [TelegramBotModule.forRoot({ token: '123:abc', launch: false })],
      providers: [
        EntryUpdate,
        SurveyScene,
        SignupWizard,
        GuardedScene,
        DenyGuard,
      ],
    }).compile();

    bot = moduleRef.get<Telegraf>(TELEGRAM_BOT);
    // ── Needed so Telegraf can strip @mentions while matching commands. ───────
    bot.botInfo = BOT_INFO;
    survey = moduleRef.get(SurveyScene);
    wizard = moduleRef.get(SignupWizard);
    guarded = moduleRef.get(GuardedScene);

    // ── Run the registrar wiring (this also triggers scenes.register()). ──────
    moduleRef
      .get(TelegramBotUpdatesRegistrar, { strict: false })
      .onModuleInit();
  });

  /** Dispatches a text message (optionally a `/command`) through the bot. */
  function send(text: string): Promise<void> {
    updateId += 1;
    const isCommand = text.startsWith('/');
    const commandWord = text.split(' ')[0] ?? text;
    const update: Update = {
      update_id: updateId,
      message: {
        message_id: updateId,
        date: 0,
        chat: { id: 100, type: 'private', first_name: 'U' },
        from: { id: 7, is_bot: false, first_name: 'U' },
        text,
        ...(isCommand
          ? {
              entities: [
                {
                  type: 'bot_command',
                  offset: 0,
                  length: commandWord.length,
                },
              ],
            }
          : {}),
      },
    };
    return bot.handleUpdate(update);
  }

  it('fires @SceneEnter with injected params on entering a scene', async () => {
    await send('/enter');

    expect(survey.events).toEqual(['enter']);
    expect(survey.sender).toEqual({ id: 7, is_bot: false, first_name: 'U' });
  });

  it('routes within-scene message handlers and runs @SceneLeave on leave', async () => {
    await send('/enter');
    await send('again');
    await send('/quit');

    expect(survey.events).toEqual(['enter', 'again', 'quit', 'leave']);
  });

  it('advances a wizard through its steps in order', async () => {
    await send('/signup');
    expect(wizard.steps).toEqual(['ask']);

    await send('Alice');
    expect(wizard.steps).toEqual(['ask', 'save']);
    expect(wizard.name).toBe('Alice');
  });

  it('applies the enhancer stack (a guard) inside a scene', async () => {
    await send('/guard');

    // ── The denying guard blocks the enter handler; it never runs. ────────────
    expect(guarded.entered).toBe(false);
  });
});
