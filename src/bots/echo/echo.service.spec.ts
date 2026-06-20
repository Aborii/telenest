/**
 * @file src/bots/echo/echo.service.spec.ts
 *
 * PURPOSE
 * -------
 * Unit tests for the echo bot's text-transformation service.
 */

import { EchoService } from './echo.service';

describe('EchoService', () => {
  const service = new EchoService();

  it('reverses a non-empty string', () => {
    expect(service.reverse('abc')).toBe('cba');
  });

  it('returns an empty string unchanged', () => {
    expect(service.reverse('')).toBe('');
  });

  it('preserves internal whitespace placement', () => {
    expect(service.reverse('a b')).toBe('b a');
  });
});
