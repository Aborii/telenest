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
  normalizeWebhookPath,
} from './telegram-webhook.helpers';

describe('normalizeWebhookPath', () => {
  it('adds a leading slash when missing', () => {
    expect(normalizeWebhookPath('hook')).toBe('/hook');
  });

  it('strips trailing slashes', () => {
    expect(normalizeWebhookPath('/hook/')).toBe('/hook');
    expect(normalizeWebhookPath('/hook///')).toBe('/hook');
  });

  it('collapses duplicate internal slashes', () => {
    expect(normalizeWebhookPath('telegram//webhook')).toBe('/telegram/webhook');
  });

  it('canonicalizes a messy path end to end', () => {
    expect(normalizeWebhookPath('  telegram//webhook/  ')).toBe(
      '/telegram/webhook',
    );
  });

  it('leaves an already-canonical path unchanged', () => {
    expect(normalizeWebhookPath('/telegram/webhook')).toBe('/telegram/webhook');
  });

  it('normalizes an empty or root path to "/"', () => {
    expect(normalizeWebhookPath('')).toBe('/');
    expect(normalizeWebhookPath('/')).toBe('/');
    expect(normalizeWebhookPath('///')).toBe('/');
  });

  it('handles a slash-heavy path in linear time (ReDoS regression)', () => {
    // A long run of slashes followed by a non-slash is the worst case for the
    // old `\/+$` backtracking regex; the split-based impl stays linear.
    const input = `${'/'.repeat(100_000)}hook${'/'.repeat(100_000)}`;
    expect(normalizeWebhookPath(input)).toBe('/hook');
  });
});

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

  it('normalizes a messy path so it matches the mounted route', () => {
    expect(joinWebhookUrl('https://x.com', 'telegram//webhook/')).toBe(
      'https://x.com/telegram/webhook',
    );
  });

  it('strips a long run of trailing slashes on the domain in linear time (ReDoS regression)', () => {
    expect(joinWebhookUrl(`https://x.com${'/'.repeat(100_000)}`, '/hook')).toBe(
      'https://x.com/hook',
    );
  });
});

describe('assertValidWebhookOptions', () => {
  it('accepts a config with a secretToken', () => {
    expect(() =>
      assertValidWebhookOptions({ path: '/hook', secretToken: 's3cr3t_token' }),
    ).not.toThrow();
  });

  it('rejects a config with no secretToken and no allowInsecure (fail closed)', () => {
    expect(() => assertValidWebhookOptions({ path: '/hook' })).toThrow(
      /requires a "secretToken"/,
    );
  });

  it('accepts an unauthenticated route only with explicit allowInsecure', () => {
    expect(() =>
      assertValidWebhookOptions({ path: '/hook', allowInsecure: true }),
    ).not.toThrow();
  });

  it('rejects a secretToken outside Telegram\'s allowed charset', () => {
    expect(() =>
      assertValidWebhookOptions({ path: '/hook', secretToken: 'bad token!' }),
    ).toThrow(/secretToken/);
  });

  it('rejects an empty path', () => {
    expect(() =>
      assertValidWebhookOptions({ path: '', secretToken: 's3cr3t' }),
    ).toThrow(TelegramConfigError);
  });

  it('rejects a blank (whitespace-only) path', () => {
    expect(() =>
      assertValidWebhookOptions({ path: '   ', secretToken: 's3cr3t' }),
    ).toThrow(TelegramConfigError);
  });

  it('rejects a path with internal whitespace', () => {
    expect(() =>
      assertValidWebhookOptions({ path: '/ho ok', secretToken: 's3cr3t' }),
    ).toThrow(/whitespace/);
  });

  it('requires a domain when registerOnBootstrap is true', () => {
    expect(() =>
      assertValidWebhookOptions({
        path: '/hook',
        secretToken: 's3cr3t',
        registerOnBootstrap: true,
      }),
    ).toThrow(/requires a "domain"/);
  });

  it('rejects an unparseable domain when registerOnBootstrap is true', () => {
    expect(() =>
      assertValidWebhookOptions({
        path: '/hook',
        secretToken: 's3cr3t',
        domain: 'not a url',
        registerOnBootstrap: true,
      }),
    ).toThrow(/not a valid URL/);
  });

  it('rejects a non-http(s) domain scheme when registerOnBootstrap is true', () => {
    expect(() =>
      assertValidWebhookOptions({
        path: '/hook',
        secretToken: 's3cr3t',
        domain: 'ftp://x.com',
        registerOnBootstrap: true,
      }),
    ).toThrow(/must be an http\(s\) URL/);
  });

  it('accepts a valid https domain with registerOnBootstrap', () => {
    expect(() =>
      assertValidWebhookOptions({
        path: '/hook',
        secretToken: 's3cr3t',
        domain: 'https://x.com',
        registerOnBootstrap: true,
      }),
    ).not.toThrow();
  });

  it('does not require a domain when registerOnBootstrap is false', () => {
    expect(() =>
      assertValidWebhookOptions({
        path: '/hook',
        secretToken: 's3cr3t',
        registerOnBootstrap: false,
      }),
    ).not.toThrow();
  });
});
