/**
 * @file src/bots/greeter/scenes/random-number.scene.spec.ts
 *
 * PURPOSE
 * -------
 * Unit tests for the random-number scene handlers.
 */

import type { GreeterContext } from '../interfaces/greeter-context.interface';
import { RandomNumberScene } from './random-number.scene';

/** Builds a fake greeter context with spyable reply + scene controls. */
function createCtx(): {
  ctx: GreeterContext;
  reply: jest.Mock;
  leave: jest.Mock;
} {
  const reply = jest.fn().mockResolvedValue(undefined);
  const leave = jest.fn().mockResolvedValue(undefined);
  const ctx = {
    reply,
    scene: { leave },
  } as unknown as GreeterContext;
  return { ctx, reply, leave };
}

describe('RandomNumberScene', () => {
  const scene = new RandomNumberScene();

  it('announces instructions on enter', async () => {
    const { ctx, reply } = createCtx();
    await scene.onSceneEnter(ctx);
    expect(reply).toHaveBeenCalledWith(expect.stringContaining('random'));
  });

  it('replies with a number in [1, 100] on "again"', async () => {
    const { ctx, reply } = createCtx();
    await scene.onAgain(ctx);

    const text = String(reply.mock.calls[0]?.[0]);
    const match = /Your number is (\d+)\./.exec(text);
    expect(match).not.toBeNull();
    const value = Number(match?.[1]);
    expect(value).toBeGreaterThanOrEqual(1);
    expect(value).toBeLessThanOrEqual(100);
  });

  it('leaves the scene on /exit', async () => {
    const { ctx, reply, leave } = createCtx();
    await scene.onExit(ctx);
    expect(leave).toHaveBeenCalled();
    expect(reply).toHaveBeenCalledWith('Scene closed.');
  });
});
