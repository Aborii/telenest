/**
 * @file src/lib/bot/webhook/telegram-webhook.guard.spec.ts
 *
 * PURPOSE
 * -------
 * Unit tests for the secret-token guard with a stubbed `ExecutionContext`:
 * matching token passes, missing/wrong token is rejected with `ForbiddenException`,
 * a duplicated (array) header uses its first value, and an unconfigured secret
 * allows the request through.
 */

import { ForbiddenException, type ExecutionContext } from '@nestjs/common';

import { TELEGRAM_WEBHOOK_SECRET_HEADER } from './telegram-webhook.constants';
import { TelegramWebhookGuard } from './telegram-webhook.guard';
import type { TelegramBotWebhookOptions } from './telegram-webhook.options';

/** Builds a stub `ExecutionContext` exposing only the given request headers. */
function contextWithHeaders(
  headers: Record<string, string | string[] | undefined>,
): ExecutionContext {
  return {
    switchToHttp: () => ({ getRequest: () => ({ headers }) }),
  } as unknown as ExecutionContext;
}

/** Builds a guard wired to the given webhook options. */
function guardFor(options: TelegramBotWebhookOptions): TelegramWebhookGuard {
  return new TelegramWebhookGuard(options);
}

describe('TelegramWebhookGuard', () => {
  const path = '/hook';

  it('allows a request whose secret-token header matches', () => {
    const guard = guardFor({ path, secretToken: 's3cr3t' });
    const ctx = contextWithHeaders({
      [TELEGRAM_WEBHOOK_SECRET_HEADER]: 's3cr3t',
    });
    expect(guard.canActivate(ctx)).toBe(true);
  });

  it('rejects a request whose secret-token header is wrong', () => {
    const guard = guardFor({ path, secretToken: 's3cr3t' });
    const ctx = contextWithHeaders({
      [TELEGRAM_WEBHOOK_SECRET_HEADER]: 'nope',
    });
    expect(() => guard.canActivate(ctx)).toThrow(ForbiddenException);
  });

  it('rejects a request missing the secret-token header', () => {
    const guard = guardFor({ path, secretToken: 's3cr3t' });
    const ctx = contextWithHeaders({});
    expect(() => guard.canActivate(ctx)).toThrow(ForbiddenException);
  });

  it('uses the first value when the header is duplicated (array)', () => {
    const guard = guardFor({ path, secretToken: 's3cr3t' });
    const ctx = contextWithHeaders({
      [TELEGRAM_WEBHOOK_SECRET_HEADER]: ['s3cr3t', 'other'],
    });
    expect(guard.canActivate(ctx)).toBe(true);
  });

  it('allows the request when no secret token is configured', () => {
    const guard = guardFor({ path });
    const ctx = contextWithHeaders({});
    expect(guard.canActivate(ctx)).toBe(true);
  });
});
