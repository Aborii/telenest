/**
 * @file src/lib/bot/webhook/secret-token.spec.ts
 *
 * PURPOSE
 * -------
 * Unit tests for the constant-time secret-token comparison. They assert correct
 * accept/reject behavior across matching, mismatching, empty, and missing inputs
 * (the timing property itself is not asserted — only correctness).
 */

import { generateWebhookSecret, timingSafeEqualSecret } from './secret-token';

describe('timingSafeEqualSecret', () => {
  it('returns true for identical secrets', () => {
    expect(timingSafeEqualSecret('s3cr3t-token', 's3cr3t-token')).toBe(true);
  });

  it('returns false when the received token differs', () => {
    expect(timingSafeEqualSecret('s3cr3t-token', 'wrong-token')).toBe(false);
  });

  it('returns false for a same-prefix token of different length', () => {
    expect(timingSafeEqualSecret('abc', 'abcd')).toBe(false);
  });

  it('returns false when the received token is undefined (header absent)', () => {
    expect(timingSafeEqualSecret('s3cr3t', undefined)).toBe(false);
  });

  it('returns false when only one side is the empty string', () => {
    expect(timingSafeEqualSecret('s3cr3t', '')).toBe(false);
  });

  it('returns true when both sides are the empty string', () => {
    // Not a configuration the guard allows (it short-circuits on a falsy
    // secret), but the comparison itself must still be value-correct.
    expect(timingSafeEqualSecret('', '')).toBe(true);
  });

  it('treats unicode secrets byte-accurately', () => {
    expect(timingSafeEqualSecret('séçret', 'séçret')).toBe(true);
    expect(timingSafeEqualSecret('séçret', 'secret')).toBe(false);
  });
});

describe('generateWebhookSecret', () => {
  it('returns a 64-char hex token by default (32 bytes)', () => {
    const secret = generateWebhookSecret();
    expect(secret).toHaveLength(64);
    expect(secret).toMatch(/^[0-9a-f]{64}$/);
  });

  it('honors a custom byte length', () => {
    expect(generateWebhookSecret(16)).toHaveLength(32);
  });

  it('stays within Telegram\'s allowed secret_token charset and length', () => {
    expect(generateWebhookSecret(128)).toMatch(/^[A-Za-z0-9_-]{1,256}$/);
  });

  it('produces a distinct value on each call', () => {
    expect(generateWebhookSecret()).not.toBe(generateWebhookSecret());
  });

  it('rejects an out-of-range byte length', () => {
    expect(() => generateWebhookSecret(0)).toThrow(RangeError);
    expect(() => generateWebhookSecret(129)).toThrow(RangeError);
    expect(() => generateWebhookSecret(1.5)).toThrow(RangeError);
  });
});
