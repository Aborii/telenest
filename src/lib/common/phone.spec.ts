/**
 * @file src/lib/common/phone.spec.ts
 *
 * PURPOSE
 * -------
 * Unit tests for {@link maskPhoneNumber}: keeps first-2 + last-2, masks the
 * middle, and fully masks short inputs.
 */

import { maskPhoneNumber } from './phone';

describe('maskPhoneNumber', () => {
  it('keeps the first two and last two characters', () => {
    expect(maskPhoneNumber('+15551234567')).toBe('+1********67');
  });

  it('fully masks a value of four characters or fewer', () => {
    expect(maskPhoneNumber('1234')).toBe('****');
    expect(maskPhoneNumber('12')).toBe('**');
    expect(maskPhoneNumber('')).toBe('');
  });

  it('never leaks the full number', () => {
    const masked = maskPhoneNumber('+447700900123');
    expect(masked).not.toContain('7700900');
    expect(masked.startsWith('+4')).toBe(true);
    expect(masked.endsWith('23')).toBe(true);
  });
});
