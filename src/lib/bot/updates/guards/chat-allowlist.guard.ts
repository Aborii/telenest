/**
 * @file src/lib/bot/updates/guards/chat-allowlist.guard.ts
 *
 * PURPOSE
 * -------
 * A built-in guard that only lets updates from an allowlisted set of chats reach
 * the handler. Useful for restricting a bot (or a specific command) to known
 * groups/channels or to a private support chat.
 *
 * USAGE
 * -----
 * ```ts
 * @UseTelegramGuards(new ChatAllowlistGuard({ allow: [-1001234567890] }))
 * @Command('deploy') onDeploy(@Ctx() ctx: Context) { ... }
 * ```
 *
 * KEY EXPORTS
 * -----------
 * - ChatAllowlistOptions: configuration for the guard.
 * - ChatAllowlistGuard: the guard implementation.
 */

import { Injectable, type ExecutionContext } from '@nestjs/common';
import type { TelegramGuard } from '../execution/enhancer.types';
import { TelegramExecutionContext } from '../execution/telegram-execution-context';

/** Configuration for {@link ChatAllowlistGuard}. */
export interface ChatAllowlistOptions {
  /** The chat IDs permitted to reach the handler. */
  readonly allow: Iterable<number>;
  /**
   * Whether to allow updates that carry no chat (rare — e.g. inline queries).
   * Defaults to `false` (deny when the chat cannot be determined).
   */
  readonly allowWhenNoChat?: boolean;
}

/**
 * Allows an update only when its originating chat ID is in the configured set.
 *
 * Configure it as an instance (it holds the allowlist), e.g.
 * `new ChatAllowlistGuard({ allow: [id1, id2] })`.
 */
@Injectable()
export class ChatAllowlistGuard implements TelegramGuard {
  /** The set of permitted chat IDs (built once from `options.allow`). */
  private readonly _allow: ReadonlySet<number>;

  /** Whether an update with no resolvable chat is allowed. */
  private readonly _allowWhenNoChat: boolean;

  /**
   * @param options - The allowlist and optional no-chat behavior.
   */
  public constructor(options: ChatAllowlistOptions) {
    this._allow = new Set(options.allow);
    this._allowWhenNoChat = options.allowWhenNoChat ?? false;
  }

  /**
   * Permits the update when `ctx.chat.id` is allowlisted.
   *
   * @param context - The execution context for the current update.
   * @returns `true` to run the handler, `false` to block the update.
   * @throws Never.
   */
  public canActivate(context: ExecutionContext): boolean {
    const ctx = TelegramExecutionContext.create(context).getContext();
    const chatId = ctx.chat?.id;
    if (chatId === undefined) return this._allowWhenNoChat;
    return this._allow.has(chatId);
  }
}
