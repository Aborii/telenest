/**
 * @file examples/scenes-wizards.example.ts
 *
 * PURPOSE
 * -------
 * A copy-paste reference for the Bot API **scene & wizard** decorators. It shows
 * how to build multi-step conversational flows declaratively — no `nestjs-telegraf`,
 * no hand-rolling a Telegraf `Stage` against the raw instance — using `@Scene` /
 * `@WizardScene` provider classes plus the lifecycle decorators (`@SceneEnter`,
 * `@SceneLeave`, `@WizardStep`). Within a scene you reuse the *same* message
 * decorators (`@Command`, `@Hears`, …), parameter decorators (`@Ctx`,
 * `@MessageText`, …), and enhancer stack (`@UseTelegramGuards`/…) as top-level
 * `@TelegramUpdate` handlers.
 *
 * The library auto-registers Telegraf's in-memory `session` middleware and the
 * scene `Stage` for you; a `@TelegramUpdate` provider simply calls
 * `ctx.scene.enter(id)` to start a flow.
 *
 * This file is illustrative — it is not part of the published package — but it is
 * type-checked (see tsconfig `include`) so it never drifts from the API.
 *
 * USAGE
 * -----
 * Adapt `ScenesExampleModule` into your own app, then `app.init()` /
 * `app.listen()` as usual. Talk to the bot: `/survey` starts the plain scene,
 * `/signup` starts the wizard.
 *
 * KEY EXPORTS
 * -----------
 * - EntryUpdate: top-level handler that enters the flows.
 * - SurveyScene: a plain `@Scene` with enter/leave + within-scene handlers.
 * - SignupWizard: a `@WizardScene` collecting a name across two steps.
 * - ScenesExampleModule: wires TelegramBotModule + the scene providers.
 */

import { Injectable, Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { Scenes } from 'telegraf';

import {
  Command,
  Ctx,
  Hears,
  MessageText,
  Scene,
  SceneEnter,
  SceneLeave,
  TelegramBotModule,
  TelegramUpdate,
  WizardScene,
  WizardStep,
} from '../src';

/**
 * The context type the scene handlers see. Telegraf's `WizardContext` carries
 * `session`, `scene` (enter/leave/state), and `wizard` (step cursor), which is
 * exactly what these flows touch.
 */
type FlowContext = Scenes.WizardContext;

/** The state the wizard accumulates across steps, stored on `ctx.wizard.state`. */
interface SignupState {
  /** The name captured by the first step. */
  name?: string;
}

/**
 * Top-level update provider. It does not handle the flow itself — it just starts
 * the right scene when the user runs a command.
 */
@TelegramUpdate()
@Injectable()
export class EntryUpdate {
  /**
   * Starts the survey scene.
   *
   * @param ctx - The update context (its `scene` is added by the Stage).
   * @returns Resolves once the scene has been entered.
   * @throws Never.
   */
  @Command('survey')
  public async startSurvey(@Ctx() ctx: FlowContext): Promise<void> {
    await ctx.scene.enter('survey');
  }

  /**
   * Starts the signup wizard.
   *
   * @param ctx - The update context.
   * @returns Resolves once the wizard has been entered.
   * @throws Never.
   */
  @Command('signup')
  public async startSignup(@Ctx() ctx: FlowContext): Promise<void> {
    await ctx.scene.enter('signup');
  }
}

/**
 * A plain scene: once entered, it greets the user, replies to "again", and exits
 * on `/quit`. `@SceneEnter`/`@SceneLeave` run on the boundaries; `@Hears`/`@Command`
 * behave exactly as at the top level but only while this scene is active.
 */
@Scene('survey')
@Injectable()
export class SurveyScene {
  /**
   * Greets the user on entering the scene.
   *
   * @param ctx - The scene context.
   * @returns Resolves once the welcome is sent.
   * @throws Never.
   */
  @SceneEnter()
  public async onEnter(@Ctx() ctx: FlowContext): Promise<void> {
    await ctx.reply('Survey started. Say "again", or /quit to leave.');
  }

  /**
   * Responds to the keyword "again" while in the scene.
   *
   * @param ctx - The scene context.
   * @returns Resolves once the reply is sent.
   * @throws Never.
   */
  @Hears('again')
  public async onAgain(@Ctx() ctx: FlowContext): Promise<void> {
    await ctx.reply('Still here! Say "again" or /quit.');
  }

  /**
   * Leaves the scene on `/quit`.
   *
   * @param ctx - The scene context.
   * @returns Resolves once the scene has been left.
   * @throws Never.
   */
  @Command('quit')
  public async onQuit(@Ctx() ctx: FlowContext): Promise<void> {
    await ctx.scene.leave();
  }

  /**
   * Says goodbye on leaving the scene.
   *
   * @param ctx - The scene context.
   * @returns Resolves once the farewell is sent.
   * @throws Never.
   */
  @SceneLeave()
  public async onLeave(@Ctx() ctx: FlowContext): Promise<void> {
    await ctx.reply('Survey closed.');
  }
}

/**
 * A two-step wizard. Steps run in ascending `@WizardStep` order; advance with
 * `ctx.wizard.next()` and finish with `ctx.scene.leave()`. State persists on
 * `ctx.wizard.state` between steps.
 */
@WizardScene('signup')
@Injectable()
export class SignupWizard {
  /**
   * Step 1 — asks for the user's name, then advances the cursor.
   *
   * @param ctx - The wizard context.
   * @returns Resolves once the prompt is sent.
   * @throws Never.
   */
  @WizardStep(1)
  public async askName(@Ctx() ctx: FlowContext): Promise<void> {
    await ctx.reply('What should I call you?');
    ctx.wizard.next();
  }

  /**
   * Step 2 — validates and stores the name, then finishes the wizard.
   *
   * @param ctx - The wizard context (for replying and leaving).
   * @param text - The incoming message text (the answer to step 1).
   * @returns Resolves once the confirmation is sent or a retry is requested.
   * @throws Never.
   */
  @WizardStep(2)
  public async saveName(
    @Ctx() ctx: FlowContext,
    @MessageText() text: string | undefined,
  ): Promise<void> {
    const name = text?.trim();
    if (!name) {
      await ctx.reply('Please send your name as plain text.');
      return;
    }
    (ctx.wizard.state as SignupState).name = name;
    await ctx.reply(`Thanks, ${name}! You're signed up.`);
    await ctx.scene.leave();
  }
}

/**
 * Root module: wires the Bot API side and registers the entry handler and both
 * scene providers. Nothing else is needed — the library discovers the scenes and
 * registers the session + Stage middleware at bootstrap.
 */
@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true }),
    TelegramBotModule.forRootAsync({
      isGlobal: true,
      inject: [ConfigService],
      useFactory: (config: ConfigService) => ({
        token: config.getOrThrow<string>('BOT_TOKEN'),
      }),
    }),
  ],
  providers: [EntryUpdate, SurveyScene, SignupWizard],
})
export class ScenesExampleModule {}
