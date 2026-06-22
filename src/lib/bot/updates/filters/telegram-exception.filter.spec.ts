/**
 * @file src/lib/bot/updates/filters/telegram-exception.filter.spec.ts
 *
 * PURPOSE
 * -------
 * Unit tests for {@link TelegramExceptionFilter}: it logs caught errors, sends an
 * optional (static or computed) reply, never throws when the reply itself fails,
 * and honours a custom or disabled logger.
 */

import { Logger, type LoggerService, type Type } from '@nestjs/common';
import type { Context } from 'telegraf';

import { TelegramExecutionContext } from '../execution/telegram-execution-context';
import { TelegramExceptionFilter } from './telegram-exception.filter';

/** Builds a host whose context records `reply` calls. */
function hostWith(reply: jest.Mock = jest.fn().mockResolvedValue(undefined)): {
  host: TelegramExecutionContext;
  reply: jest.Mock;
} {
  const ctx = { reply } as unknown as Context;
  const host = new TelegramExecutionContext(
    ctx,
    class {} as Type,
    () => undefined,
  );
  return { host, reply };
}

describe('TelegramExceptionFilter', () => {
  let errorSpy: jest.SpyInstance;

  beforeEach(() => {
    errorSpy = jest
      .spyOn(Logger.prototype, 'error')
      .mockImplementation(() => undefined);
  });

  afterEach(() => {
    errorSpy.mockRestore();
  });

  it('logs the error and sends no reply by default', async () => {
    const { host, reply } = hostWith();
    const filter = new TelegramExceptionFilter();

    await filter.catch(new Error('boom'), host);

    expect(errorSpy).toHaveBeenCalledWith(expect.stringContaining('boom'));
    expect(reply).not.toHaveBeenCalled();
  });

  it('sends a fixed reply string when configured', async () => {
    const { host, reply } = hostWith();
    const filter = new TelegramExceptionFilter({ reply: 'Try again later.' });

    await filter.catch(new Error('boom'), host);

    expect(reply).toHaveBeenCalledWith('Try again later.');
  });

  it('computes the reply from a factory, with access to error and ctx', async () => {
    const { host, reply } = hostWith();
    const factory = jest.fn(
      (error: unknown) =>
        `Failed: ${error instanceof Error ? error.message : 'unknown'}`,
    );
    const filter = new TelegramExceptionFilter({ reply: factory });

    await filter.catch(new Error('nope'), host);

    expect(factory).toHaveBeenCalledTimes(1);
    expect(reply).toHaveBeenCalledWith('Failed: nope');
  });

  it('sends nothing when the reply factory returns undefined', async () => {
    const { host, reply } = hostWith();
    const filter = new TelegramExceptionFilter({ reply: () => undefined });

    await filter.catch(new Error('boom'), host);

    expect(reply).not.toHaveBeenCalled();
  });

  it('never throws when sending the reply fails', async () => {
    const reply = jest.fn().mockRejectedValue(new Error('blocked by user'));
    const { host } = hostWith(reply);
    const filter = new TelegramExceptionFilter({ reply: 'hi' });

    await expect(
      filter.catch(new Error('boom'), host),
    ).resolves.toBeUndefined();
    // ── Both the original error and the reply failure are logged. ─────────────
    expect(errorSpy).toHaveBeenCalledTimes(2);
  });

  it('stringifies non-Error throwables for the log message', async () => {
    const { host } = hostWith();
    const filter = new TelegramExceptionFilter();

    await filter.catch('just a string', host);

    expect(errorSpy).toHaveBeenCalledWith(
      expect.stringContaining('just a string'),
    );
  });

  it('routes logging through a custom logger', async () => {
    const custom: LoggerService = {
      log: jest.fn(),
      error: jest.fn(),
      warn: jest.fn(),
      debug: jest.fn(),
      verbose: jest.fn(),
    };
    const { host } = hostWith();
    const filter = new TelegramExceptionFilter({ logger: custom });

    await filter.catch(new Error('boom'), host);

    expect(custom.error).toHaveBeenCalledTimes(1);
    expect(errorSpy).not.toHaveBeenCalled();
  });

  it('disables logging when logger is false', async () => {
    const { host } = hostWith();
    const filter = new TelegramExceptionFilter({ logger: false });

    await filter.catch(new Error('boom'), host);

    expect(errorSpy).not.toHaveBeenCalled();
  });
});
