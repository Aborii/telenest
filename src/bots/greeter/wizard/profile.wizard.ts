/**
 * @file src/bots/greeter/wizard/profile.wizard.ts
 *
 * PURPOSE
 * -------
 * Demonstrates a two-step wizard flow that collects and confirms a profile name.
 *
 * USAGE
 * -----
 * Provided by GreeterModule and entered via /wizard command.
 */

import { Ctx, Wizard, WizardStep } from 'nestjs-telegraf';
import { PROFILE_WIZARD_ID } from '../greeter.constants';
import { GreeterContext } from '../interfaces/greeter-context.interface';

/** Typed wizard state payload used by profile flow. */
type ProfileWizardState = {
  /** Optional profile name captured from user input. */
  profileName?: string;
};

/**
 * Wizard that asks for a preferred profile name and stores it in session.
 */
@Wizard(PROFILE_WIZARD_ID)
export class ProfileWizard {
  /**
   * First wizard step: asks user for desired profile name.
   *
   * @param ctx - Greeter context with wizard controls.
   * @returns Promise that resolves after asking the question.
   * @throws {Error} When Telegram API request fails.
   */
  @WizardStep(1)
  async askName(@Ctx() ctx: GreeterContext): Promise<void> {
    await ctx.reply('What should I call you?');
    ctx.wizard.next();
  }

  /**
   * Second wizard step: validates and persists the user name.
   *
   * @param ctx - Greeter context with wizard controls.
   * @returns Promise that resolves after completion or retry prompt.
   * @throws {Error} When Telegram API request fails.
   */
  @WizardStep(2)
  async saveName(@Ctx() ctx: GreeterContext): Promise<void> {
    const name = this.readMessageText(ctx)?.trim();
    if (!name) {
      await ctx.reply('Please send plain text for your name.');
      return;
    }

    // ── Persist and close wizard ────────────────────────────────────────────
    const wizardState = ctx.wizard.state as ProfileWizardState;
    wizardState.profileName = name;
    await ctx.reply(`Great. I will call you ${name}.`);
    await ctx.scene.leave();
  }

  /**
   * Reads text from a wizard message update if available.
   *
   * @param ctx - Greeter context carrying message payload.
   * @returns Text value from update payload, if present.
   * @throws {Error} Never intentionally throws.
   */
  private readMessageText(ctx: GreeterContext): string | undefined {
    const message = ctx.message;
    if (!message || typeof message !== 'object') return undefined;
    if (!('text' in message)) return undefined;

    const raw = message.text;
    return typeof raw === 'string' ? raw : undefined;
  }
}
