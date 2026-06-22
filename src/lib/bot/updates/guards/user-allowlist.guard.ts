/**
 * @file src/lib/bot/updates/guards/user-allowlist.guard.ts
 *
 * PURPOSE
 * -------
 * A built-in guard that only lets updates from an allowlisted set of users
 * (senders) reach the handler. Useful for admin-only commands or a bot limited to
 * a known group of people.
 *
 * USAGE
 * -----
 * ```ts
 * @UseTelegramGuards(new UserAllowlistGuard({ allow: [ADMIN_USER_ID] }))
 * @Command('shutdown') onShutdown(@Ctx() ctx: Context) { ... }
 * ```
 *
 * KEY EXPORTS
 * -----------
 * - UserAllowlistOptions: configuration for the guard.
 * - UserAllowlistGuard: the guard implementation.
 */

import { Injectable, type ExecutionContext } from '@nestjs/common';

import type { TelegramGuard } from '../execution/enhancer.types';
import { TelegramExecutionContext } from '../execution/telegram-execution-context';

/** Configuration for {@link UserAllowlistGuard}. */
export interface UserAllowlistOptions {
  /** The user IDs permitted to reach the handler. */
  readonly allow: Iterable<number>;
  /**
   * Whether to allow updates that carry no sender (`ctx.from` absent, e.g. some
   * channel posts). Defaults to `false` (deny when the sender is unknown).
   */
  readonly allowWhenNoSender?: boolean;
}

/**
 * Allows an update only when its sender's user ID is in the configured set.
 *
 * Configure it as an instance (it holds the allowlist), e.g.
 * `new UserAllowlistGuard({ allow: [adminId] })`.
 */
@Injectable()
export class UserAllowlistGuard implements TelegramGuard {
  /** The set of permitted user IDs (built once from `options.allow`). */
  private readonly _allow: ReadonlySet<number>;

  /** Whether an update with no resolvable sender is allowed. */
  private readonly _allowWhenNoSender: boolean;

  /**
   * @param options - The allowlist and optional no-sender behavior.
   */
  public constructor(options: UserAllowlistOptions) {
    this._allow = new Set(options.allow);
    this._allowWhenNoSender = options.allowWhenNoSender ?? false;
  }

  /**
   * Permits the update when `ctx.from.id` is allowlisted.
   *
   * @param context - The execution context for the current update.
   * @returns `true` to run the handler, `false` to block the update.
   * @throws Never.
   */
  public canActivate(context: ExecutionContext): boolean {
    const ctx = TelegramExecutionContext.create(context).getContext();
    const userId = ctx.from?.id;
    if (userId === undefined) return this._allowWhenNoSender;
    return this._allow.has(userId);
  }
}
