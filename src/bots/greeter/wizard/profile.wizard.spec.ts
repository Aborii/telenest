/**
 * @file src/bots/greeter/wizard/profile.wizard.spec.ts
 *
 * PURPOSE
 * -------
 * Unit tests for the two-step profile wizard.
 */

import type { GreeterContext } from '../interfaces/greeter-context.interface';
import { ProfileWizard } from './profile.wizard';

/** Builds a fake wizard context with spyable controls and a message. */
function createCtx(options: { text?: string; noText?: boolean }): {
  ctx: GreeterContext;
  reply: jest.Mock;
  next: jest.Mock;
  leave: jest.Mock;
  state: { profileName?: string };
} {
  const reply = jest.fn().mockResolvedValue(undefined);
  const next = jest.fn();
  const leave = jest.fn().mockResolvedValue(undefined);
  const state: { profileName?: string } = {};
  const message = options.noText ? { photo: [] } : { text: options.text ?? '' };
  const ctx = {
    reply,
    wizard: { next, state },
    scene: { leave },
    message,
  } as unknown as GreeterContext;
  return { ctx, reply, next, leave, state };
}

describe('ProfileWizard', () => {
  const wizard = new ProfileWizard();

  it('asks for the name and advances on step 1', async () => {
    const { ctx, reply, next } = createCtx({});
    await wizard.askName(ctx);
    expect(reply).toHaveBeenCalledWith('What should I call you?');
    expect(next).toHaveBeenCalled();
  });

  it('persists a valid name and leaves on step 2', async () => {
    const { ctx, reply, leave, state } = createCtx({ text: 'Ada' });
    await wizard.saveName(ctx);
    expect(state.profileName).toBe('Ada');
    expect(reply).toHaveBeenCalledWith(expect.stringContaining('Ada'));
    expect(leave).toHaveBeenCalled();
  });

  it('re-prompts and does not leave on a non-text reply', async () => {
    const { ctx, reply, leave, state } = createCtx({ noText: true });
    await wizard.saveName(ctx);
    expect(reply).toHaveBeenCalledWith(
      expect.stringContaining('plain text'),
    );
    expect(state.profileName).toBeUndefined();
    expect(leave).not.toHaveBeenCalled();
  });

  it('rejects a whitespace-only name', async () => {
    const { ctx, reply, leave, state } = createCtx({ text: '   ' });
    await wizard.saveName(ctx);
    expect(reply).toHaveBeenCalledWith(expect.stringContaining('plain text'));
    expect(state.profileName).toBeUndefined();
    expect(leave).not.toHaveBeenCalled();
  });
});
