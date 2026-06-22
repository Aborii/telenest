/**
 * @file src/bots/greeter/greeter.update.ts
 *
 * PURPOSE
 * -------
 * Update handlers for greeting flows and scene/wizard navigation.
 *
 * USAGE
 * -----
 * Registered as a provider in GreeterModule.
 */

import { Command, Ctx, Hears, Start, Update } from 'nestjs-telegraf';

import { PROFILE_WIZARD_ID, RANDOM_NUMBER_SCENE_ID } from './greeter.constants';
import { GreeterContext } from './interfaces/greeter-context.interface';

/**
 * Handles greeter bot update events and scene/wizard entry commands.
 */
@Update()
export class GreeterUpdate {
  /**
   * Welcomes users and advertises available features.
   *
   * @param ctx - Greeter context for this update.
   * @returns Promise that resolves after sending reply.
   * @throws {Error} When Telegram API request fails.
   */
  @Start()
  async onStart(@Ctx() ctx: GreeterContext): Promise<void> {
    await ctx.reply(
      'Say hello, use /scene for random numbers, or /wizard for profile setup.',
    );
  }

  /**
   * Replies to common greeting keywords.
   *
   * @param ctx - Greeter context for this update.
   * @returns Promise that resolves after sending reply.
   * @throws {Error} When Telegram API request fails.
   */
  @Hears(['hi', 'hello', 'hey', 'qq'])
  async onGreeting(@Ctx() ctx: GreeterContext): Promise<void> {
    const firstName = ctx.from?.first_name ?? 'there';
    await ctx.reply(`Hey ${firstName}. Try /scene or /wizard.`);
  }

  /**
   * Enters random number scene.
   *
   * @param ctx - Greeter context with scene controls.
   * @returns Promise that resolves after entering scene.
   * @throws {Error} When Telegram API request fails.
   */
  @Command('scene')
  async onScene(@Ctx() ctx: GreeterContext): Promise<void> {
    await ctx.scene.enter(RANDOM_NUMBER_SCENE_ID);
  }

  /**
   * Enters profile wizard flow.
   *
   * @param ctx - Greeter context with scene controls.
   * @returns Promise that resolves after entering wizard.
   * @throws {Error} When Telegram API request fails.
   */
  @Command('wizard')
  async onWizard(@Ctx() ctx: GreeterContext): Promise<void> {
    await ctx.scene.enter(PROFILE_WIZARD_ID);
  }
}
