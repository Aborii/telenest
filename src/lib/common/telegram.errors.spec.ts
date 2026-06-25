/**
 * @file src/lib/common/telegram.errors.spec.ts
 *
 * PURPOSE
 * -------
 * Unit tests for the typed error hierarchy: discriminators, metadata fields,
 * prototype-chain integrity (so `instanceof` works after transpilation), cause
 * preservation, and the {@link isTelegramError} guard.
 */

import {
  isTelegramError,
  TELEGRAM_AUTH_ERROR_CODE_VALUES,
  TelegramAuthError,
  TelegramBotApiError,
  TelegramClientError,
  TelegramConfigError,
  TelegramError,
  TelegramSessionError,
} from './telegram.errors';

describe('Telegram error hierarchy', () => {
  it('TelegramConfigError carries the "config" kind and is a TelegramError', () => {
    const error = new TelegramConfigError('bad token');

    expect(error).toBeInstanceOf(TelegramError);
    expect(error).toBeInstanceOf(Error);
    expect(error.kind).toBe('config');
    expect(error.name).toBe('TelegramConfigError');
    expect(error.message).toBe('bad token');
  });

  it('TelegramBotApiError exposes statusCode and method', () => {
    const cause = new Error('429');
    const error = new TelegramBotApiError('rate limited', {
      statusCode: 429,
      method: 'sendMessage',
      cause,
    });

    expect(error.kind).toBe('bot-api');
    expect(error.statusCode).toBe(429);
    expect(error.method).toBe('sendMessage');
    expect(error.cause).toBe(cause);
  });

  it('TelegramClientError exposes the failing operation', () => {
    const error = new TelegramClientError('boom', { operation: 'getDialogs' });

    expect(error.kind).toBe('client');
    expect(error.operation).toBe('getDialogs');
    expect(error.retryAfterSeconds).toBeUndefined();
  });

  it('TelegramClientError carries an optional flood-wait delay', () => {
    const error = new TelegramClientError('rate limited', {
      operation: 'sendMessage',
      retryAfterSeconds: 25,
    });

    expect(error.retryAfterSeconds).toBe(25);
  });

  it('TelegramAuthError carries a code and optional retry delay', () => {
    const error = new TelegramAuthError('FLOOD_WAIT', 'wait', {
      retryAfterSeconds: 30,
    });

    expect(error.kind).toBe('auth');
    expect(error.code).toBe('FLOOD_WAIT');
    expect(error.retryAfterSeconds).toBe(30);
  });

  it('TelegramAuthError defaults its message from the code', () => {
    const error = new TelegramAuthError('PASSWORD_REQUIRED');
    expect(error.message).toContain('PASSWORD_REQUIRED');
  });

  it('TelegramSessionError carries the "session" kind and cause', () => {
    const cause = new Error('EACCES');
    const error = new TelegramSessionError('cannot write', cause);

    expect(error.kind).toBe('session');
    expect(error.cause).toBe(cause);
  });

  it('exposes every auth code in the values array', () => {
    expect(TELEGRAM_AUTH_ERROR_CODE_VALUES).toContain('PASSWORD_REQUIRED');
    expect(TELEGRAM_AUTH_ERROR_CODE_VALUES).toContain('UNKNOWN');
    expect(new Set(TELEGRAM_AUTH_ERROR_CODE_VALUES).size).toBe(
      TELEGRAM_AUTH_ERROR_CODE_VALUES.length,
    );
  });

  describe('isTelegramError', () => {
    it('returns true for library errors', () => {
      expect(isTelegramError(new TelegramConfigError('x'))).toBe(true);
      expect(isTelegramError(new TelegramAuthError('UNKNOWN'))).toBe(true);
    });

    it('returns false for plain errors and non-errors', () => {
      expect(isTelegramError(new Error('x'))).toBe(false);
      expect(isTelegramError('nope')).toBe(false);
      expect(isTelegramError(undefined)).toBe(false);
    });
  });
});
