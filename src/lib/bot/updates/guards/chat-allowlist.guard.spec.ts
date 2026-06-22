/**
 * @file src/lib/bot/updates/guards/chat-allowlist.guard.spec.ts
 *
 * PURPOSE
 * -------
 * Unit tests for {@link ChatAllowlistGuard}: allows updates from allowlisted
 * chats, denies the rest, and applies the configurable no-chat behaviour.
 */

import type { ExecutionContext, Type } from '@nestjs/common';
import type { Context } from 'telegraf';
import { TelegramExecutionContext } from '../execution/telegram-execution-context';
import { ChatAllowlistGuard } from './chat-allowlist.guard';

/** Builds an execution context whose update carries the given (optional) chat. */
function contextFor(chat?: { id: number }): ExecutionContext {
  const ctx = { chat } as unknown as Context;
  return new TelegramExecutionContext(ctx, class {} as Type, () => undefined);
}

describe('ChatAllowlistGuard', () => {
  it('allows an update from an allowlisted chat', () => {
    const guard = new ChatAllowlistGuard({ allow: [10, 20] });
    expect(guard.canActivate(contextFor({ id: 20 }))).toBe(true);
  });

  it('denies an update from a chat not on the allowlist', () => {
    const guard = new ChatAllowlistGuard({ allow: [10, 20] });
    expect(guard.canActivate(contextFor({ id: 30 }))).toBe(false);
  });

  it('denies an update with no chat by default', () => {
    const guard = new ChatAllowlistGuard({ allow: [10] });
    expect(guard.canActivate(contextFor(undefined))).toBe(false);
  });

  it('allows an update with no chat when allowWhenNoChat is true', () => {
    const guard = new ChatAllowlistGuard({ allow: [10], allowWhenNoChat: true });
    expect(guard.canActivate(contextFor(undefined))).toBe(true);
  });
});
