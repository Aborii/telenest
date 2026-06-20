/**
 * @file src/common/config/env.config.spec.ts
 *
 * PURPOSE
 * -------
 * Unit tests for the Telegraf launch-options helper.
 */

import { buildLaunchOptions } from './env.config';

describe('buildLaunchOptions', () => {
  it('returns undefined when neither domain nor path is set (polling)', () => {
    expect(buildLaunchOptions(undefined, undefined)).toBeUndefined();
  });

  it('builds webhook options when both are set', () => {
    expect(buildLaunchOptions('https://example.com', '/hook')).toEqual({
      webhook: { domain: 'https://example.com', path: '/hook' },
    });
  });

  it('throws when only the domain is set', () => {
    expect(() => buildLaunchOptions('https://example.com', undefined)).toThrow(
      /both domain and path/,
    );
  });

  it('throws when only the path is set', () => {
    expect(() => buildLaunchOptions(undefined, '/hook')).toThrow(
      /both domain and path/,
    );
  });
});
