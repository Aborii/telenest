/**
 * @file src/lib/bot/updates/guards/user-allowlist.guard.spec.ts
 *
 * PURPOSE
 * -------
 * Unit tests for {@link UserAllowlistGuard}: allows updates from allowlisted
 * senders, denies the rest, and applies the configurable no-sender behaviour.
 */

import type { ExecutionContext, Type } from '@nestjs/common';
import type { Context } from 'telegraf';

import { TelegramExecutionContext } from '../execution/telegram-execution-context';
import { UserAllowlistGuard } from './user-allowlist.guard';

/** Builds an execution context whose update carries the given (optional) sender. */
function contextFor(from?: { id: number }): ExecutionContext {
  const ctx = { from } as unknown as Context;
  return new TelegramExecutionContext(ctx, class {} as Type, () => undefined);
}

describe('UserAllowlistGuard', () => {
  it('allows an update from an allowlisted sender', () => {
    const guard = new UserAllowlistGuard({ allow: [1, 2, 3] });
    expect(guard.canActivate(contextFor({ id: 2 }))).toBe(true);
  });

  it('denies an update from a sender not on the allowlist', () => {
    const guard = new UserAllowlistGuard({ allow: [1, 2, 3] });
    expect(guard.canActivate(contextFor({ id: 9 }))).toBe(false);
  });

  it('denies an update with no sender by default', () => {
    const guard = new UserAllowlistGuard({ allow: [1] });
    expect(guard.canActivate(contextFor(undefined))).toBe(false);
  });

  it('allows an update with no sender when allowWhenNoSender is true', () => {
    const guard = new UserAllowlistGuard({
      allow: [1],
      allowWhenNoSender: true,
    });
    expect(guard.canActivate(contextFor(undefined))).toBe(true);
  });
});
