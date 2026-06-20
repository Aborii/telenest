/**
 * @file src/common/config/env.validation.spec.ts
 *
 * PURPOSE
 * -------
 * Unit tests for environment validation/normalization.
 */

import { validateEnvironment } from './env.validation';

describe('validateEnvironment', () => {
  it('accepts and trims the required tokens', () => {
    const result = validateEnvironment({
      ECHO_BOT_TOKEN: '  echo-token  ',
      GREETER_BOT_TOKEN: 'greeter-token',
    });
    expect(result.ECHO_BOT_TOKEN).toBe('echo-token');
    expect(result.GREETER_BOT_TOKEN).toBe('greeter-token');
    expect(result.ECHO_BOT_WEBHOOK_DOMAIN).toBeUndefined();
  });

  it('normalizes optional webhook values (trim, empty -> undefined)', () => {
    const result = validateEnvironment({
      ECHO_BOT_TOKEN: 'a',
      GREETER_BOT_TOKEN: 'b',
      ECHO_BOT_WEBHOOK_DOMAIN: '  https://x  ',
      ECHO_BOT_WEBHOOK_PATH: '   ',
      GREETER_BOT_WEBHOOK_DOMAIN: 'https://y',
      GREETER_BOT_WEBHOOK_PATH: '/h',
    });
    expect(result.ECHO_BOT_WEBHOOK_DOMAIN).toBe('https://x');
    expect(result.ECHO_BOT_WEBHOOK_PATH).toBeUndefined();
    expect(result.GREETER_BOT_WEBHOOK_DOMAIN).toBe('https://y');
    expect(result.GREETER_BOT_WEBHOOK_PATH).toBe('/h');
  });

  it('throws when a required token is missing', () => {
    expect(() =>
      validateEnvironment({ GREETER_BOT_TOKEN: 'b' }),
    ).toThrow(/Missing required environment variable: ECHO_BOT_TOKEN/);
  });

  it('throws when a required token is empty/whitespace', () => {
    expect(() =>
      validateEnvironment({ ECHO_BOT_TOKEN: '   ', GREETER_BOT_TOKEN: 'b' }),
    ).toThrow(/cannot be empty: ECHO_BOT_TOKEN/);
  });

  it('throws when a required token is not a string', () => {
    expect(() =>
      validateEnvironment({ ECHO_BOT_TOKEN: 123, GREETER_BOT_TOKEN: 'b' }),
    ).toThrow(/Missing required environment variable: ECHO_BOT_TOKEN/);
  });

  it('treats non-string optional webhook values as undefined', () => {
    const result = validateEnvironment({
      ECHO_BOT_TOKEN: 'a',
      GREETER_BOT_TOKEN: 'b',
      ECHO_BOT_WEBHOOK_DOMAIN: 123,
      ECHO_BOT_WEBHOOK_PATH: false,
      GREETER_BOT_WEBHOOK_DOMAIN: { nested: true },
      GREETER_BOT_WEBHOOK_PATH: null,
    });
    expect(result.ECHO_BOT_WEBHOOK_DOMAIN).toBeUndefined();
    expect(result.ECHO_BOT_WEBHOOK_PATH).toBeUndefined();
    expect(result.GREETER_BOT_WEBHOOK_DOMAIN).toBeUndefined();
    expect(result.GREETER_BOT_WEBHOOK_PATH).toBeUndefined();
  });
});
