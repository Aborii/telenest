/**
 * @file src/bots/echo/echo.update.spec.ts
 *
 * PURPOSE
 * -------
 * Unit tests for the echo bot's update handlers. A minimal fake Telegraf
 * `Context` captures replies so each handler's output is asserted directly.
 */

import type { Context } from 'telegraf';
import { ECHO_HELP_TEXT } from './echo.constants';
import { EchoService } from './echo.service';
import { EchoUpdate } from './echo.update';

/** Builds a fake Context with a spyable `reply` and the given message/from. */
function createCtx(options: {
  text?: string;
  firstName?: string;
  noText?: boolean;
}): { ctx: Context; reply: jest.Mock } {
  const reply = jest.fn().mockResolvedValue(undefined);
  // A non-text message (no `text` field) drives the early-return path.
  const message = options.noText
    ? { photo: [] }
    : { text: options.text ?? '' };
  const ctx = {
    reply,
    from: options.firstName ? { first_name: options.firstName } : undefined,
    message,
  } as unknown as Context;
  return { ctx, reply };
}

describe('EchoUpdate', () => {
  const update = new EchoUpdate(new EchoService());

  it('replies with help text on /start', async () => {
    const { ctx, reply } = createCtx({});
    await update.onStart(ctx);
    expect(reply).toHaveBeenCalledWith(ECHO_HELP_TEXT);
  });

  it('replies with help text on /help', async () => {
    const { ctx, reply } = createCtx({});
    await update.onHelp(ctx);
    expect(reply).toHaveBeenCalledWith(ECHO_HELP_TEXT);
  });

  it('greets by first name when available', async () => {
    const { ctx, reply } = createCtx({ firstName: 'Ada' });
    await update.onGreeting(ctx);
    expect(reply).toHaveBeenCalledWith(expect.stringContaining('Ada'));
  });

  it('greets a "friend" when the name is unknown', async () => {
    const { ctx, reply } = createCtx({});
    await update.onGreeting(ctx);
    expect(reply).toHaveBeenCalledWith(expect.stringContaining('friend'));
  });

  it('echoes plain text', async () => {
    const { ctx, reply } = createCtx({ text: 'hello world' });
    await update.onText(ctx);
    expect(reply).toHaveBeenCalledWith('Echo: hello world');
  });

  it('reverses text after the "reverse " command', async () => {
    const { ctx, reply } = createCtx({ text: 'reverse abc' });
    await update.onText(ctx);
    expect(reply).toHaveBeenCalledWith('cba');
  });

  it('handles an empty reverse payload', async () => {
    const { ctx, reply } = createCtx({ text: 'reverse ' });
    await update.onText(ctx);
    expect(reply).toHaveBeenCalledWith('Nothing to reverse.');
  });

  it('ignores a non-text message', async () => {
    const { ctx, reply } = createCtx({ noText: true });
    await update.onText(ctx);
    expect(reply).not.toHaveBeenCalled();
  });
});
