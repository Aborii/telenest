/**
 * @file src/bots/greeter/scenes/random-number.scene.ts
 *
 * PURPOSE
 * -------
 * Demonstrates scene support with simple random-number replies.
 *
 * USAGE
 * -----
 * Provided by GreeterModule and entered via /scene command.
 */

import { Command, Ctx, Hears, Scene, SceneEnter } from 'nestjs-telegraf';
import {
  RANDOM_NUMBER_SCENE_ID,
  RANDOM_SCENE_PROMPT,
} from '../greeter.constants';
import { GreeterContext } from '../interfaces/greeter-context.interface';

/**
 * Scene that repeatedly returns random numbers until user exits.
 */
@Scene(RANDOM_NUMBER_SCENE_ID)
export class RandomNumberScene {
  /**
   * Announces scene usage instructions on enter.
   *
   * @param ctx - Greeter context with scene capabilities.
   * @returns Promise that resolves when reply is delivered.
   * @throws {Error} When Telegram API request fails.
   */
  @SceneEnter()
  async onSceneEnter(@Ctx() ctx: GreeterContext): Promise<void> {
    await ctx.reply(`Welcome to random scene. ${RANDOM_SCENE_PROMPT}`);
  }

  /**
   * Generates a random number when user says "again".
   *
   * @param ctx - Greeter context with scene capabilities.
   * @returns Promise that resolves when reply is delivered.
   * @throws {Error} When Telegram API request fails.
   */
  @Hears('again')
  async onAgain(@Ctx() ctx: GreeterContext): Promise<void> {
    const value = Math.floor(Math.random() * 100) + 1;
    await ctx.reply(`Your number is ${value}. Type again for another one.`);
  }

  /**
   * Leaves the current scene on /exit command.
   *
   * @param ctx - Greeter context with scene capabilities.
   * @returns Promise that resolves when scene is left.
   * @throws {Error} When Telegram API request fails.
   */
  @Command('exit')
  async onExit(@Ctx() ctx: GreeterContext): Promise<void> {
    await ctx.scene.leave();
    await ctx.reply('Scene closed.');
  }
}
