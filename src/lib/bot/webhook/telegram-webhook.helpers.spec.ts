/**
 * @file src/lib/bot/webhook/telegram-webhook.helpers.spec.ts
 *
 * PURPOSE
 * -------
 * Unit tests for the pure webhook helpers: URL joining (slash handling, base
 * paths) and registration-time options validation (the fail-fast rules).
 */

import { TelegramConfigError } from '../../common';
import {
  assertValidWebhookOptions,
  joinWebhookUrl,
} from './telegram-webhook.helpers';

describe('joinWebhookUrl', () => {
  it('joins a plain domain and an absolute path', () => {
    expect(joinWebhookUrl('https://x.com', '/hook')).toBe('https://x.com/hook');
  });

  it('tolerates a trailing slash on the domain', () => {
    expect(joinWebhookUrl('https://x.com/', '/hook')).toBe('https://x.com/hook');
  });

  it('adds a missing leading slash to the path', () => {
    expect(joinWebhookUrl('https://x.com', 'hook')).toBe('https://x.com/hook');
  });

  it('preserves a base path already present on the domain', () => {
    expect(joinWebhookUrl('https://x.com/api/', '/tg')).toBe(
      'https://x.com/api/tg',
    );
  });
});

describe('assertValidWebhookOptions', () => {
  it('accepts a minimal config with just a path', () => {
    expect(() => assertValidWebhookOptions({ path: '/hook' })).not.toThrow();
  });

  it('rejects an empty path', () => {
    expect(() => assertValidWebhookOptions({ path: '' })).toThrow(
      TelegramConfigError,
    );
  });

  it('rejects a blank (whitespace-only) path', () => {
    expect(() => assertValidWebhookOptions({ path: '   ' })).toThrow(
      TelegramConfigError,
    );
  });

  it('requires a domain when registerOnBootstrap is true', () => {
    expect(() =>
      assertValidWebhookOptions({ path: '/hook', registerOnBootstrap: true }),
    ).toThrow(/requires a "domain"/);
  });

  it('rejects an unparseable domain when registerOnBootstrap is true', () => {
    expect(() =>
      assertValidWebhookOptions({
        path: '/hook',
        domain: 'not a url',
        registerOnBootstrap: true,
      }),
    ).toThrow(/not a valid URL/);
  });

  it('rejects a non-http(s) domain scheme when registerOnBootstrap is true', () => {
    expect(() =>
      assertValidWebhookOptions({
        path: '/hook',
        domain: 'ftp://x.com',
        registerOnBootstrap: true,
      }),
    ).toThrow(/must be an http\(s\) URL/);
  });

  it('accepts a valid https domain with registerOnBootstrap', () => {
    expect(() =>
      assertValidWebhookOptions({
        path: '/hook',
        domain: 'https://x.com',
        registerOnBootstrap: true,
      }),
    ).not.toThrow();
  });

  it('does not require a domain when registerOnBootstrap is false', () => {
    expect(() =>
      assertValidWebhookOptions({ path: '/hook', registerOnBootstrap: false }),
    ).not.toThrow();
  });
});
