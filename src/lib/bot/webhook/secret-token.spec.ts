/**
 * @file src/lib/bot/webhook/secret-token.spec.ts
 *
 * PURPOSE
 * -------
 * Unit tests for the constant-time secret-token comparison. They assert correct
 * accept/reject behavior across matching, mismatching, empty, and missing inputs
 * (the timing property itself is not asserted — only correctness).
 */

import { timingSafeEqualSecret } from './secret-token';

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
