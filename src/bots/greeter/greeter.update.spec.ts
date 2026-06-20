/**
 * @file src/bots/greeter/greeter.update.spec.ts
 *
 * PURPOSE
 * -------
 * Unit tests for the greeter bot's update handlers, including scene/wizard entry.
 */

import {
  PROFILE_WIZARD_ID,
  RANDOM_NUMBER_SCENE_ID,
} from './greeter.constants';
import { GreeterUpdate } from './greeter.update';
import type { GreeterContext } from './interfaces/greeter-context.interface';

/** Builds a fake greeter context with spyable reply + scene controls. */
function createCtx(firstName?: string): {
  ctx: GreeterContext;
  reply: jest.Mock;
  enter: jest.Mock;
} {
  const reply = jest.fn().mockResolvedValue(undefined);
  const enter = jest.fn().mockResolvedValue(undefined);
  const ctx = {
    reply,
    from: firstName ? { first_name: firstName } : undefined,
    scene: { enter },
  } as unknown as GreeterContext;
  return { ctx, reply, enter };
}

describe('GreeterUpdate', () => {
  const update = new GreeterUpdate();

  it('welcomes the user on /start', async () => {
    const { ctx, reply } = createCtx();
    await update.onStart(ctx);
    expect(reply).toHaveBeenCalledWith(expect.stringContaining('/scene'));
  });

  it('greets by first name', async () => {
    const { ctx, reply } = createCtx('Ada');
    await update.onGreeting(ctx);
    expect(reply).toHaveBeenCalledWith(expect.stringContaining('Ada'));
  });

  it('greets "there" when name is unknown', async () => {
    const { ctx, reply } = createCtx();
    await update.onGreeting(ctx);
    expect(reply).toHaveBeenCalledWith(expect.stringContaining('there'));
  });

  it('enters the random-number scene on /scene', async () => {
    const { ctx, enter } = createCtx();
    await update.onScene(ctx);
    expect(enter).toHaveBeenCalledWith(RANDOM_NUMBER_SCENE_ID);
  });

  it('enters the profile wizard on /wizard', async () => {
    const { ctx, enter } = createCtx();
    await update.onWizard(ctx);
    expect(enter).toHaveBeenCalledWith(PROFILE_WIZARD_ID);
  });
});
