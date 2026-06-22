/**
 * @file src/lib/bot/updates/filters/telegram-exception.filter.ts
 *
 * PURPOSE
 * -------
 * The default Bot API exception filter. Catches any error thrown while processing
 * an update (in a guard, interceptor, or the handler itself), logs it through the
 * Nest `Logger`, and — when configured — sends a user-facing reply so a failed
 * handler degrades gracefully instead of silently dropping the update.
 *
 * USAGE
 * -----
 * ```ts
 * @UseTelegramFilters(
 *   new TelegramExceptionFilter({ reply: 'Sorry, something went wrong.' }),
 * )
 * @TelegramUpdate()
 * export class SupportUpdate { ... }
 * ```
 *
 * KEY EXPORTS
 * -----------
 * - TelegramExceptionFilterOptions: configuration for the filter.
 * - TelegramExceptionFilter: the default catch-all filter.
 */

import {
  Catch,
  Injectable,
  Logger,
  type ArgumentsHost,
  type LoggerService,
} from '@nestjs/common';
import type { Context } from 'telegraf';
import type { TelegramFilter } from '../execution/enhancer.types';
import { TelegramExecutionContext } from '../execution/telegram-execution-context';

/**
 * Builds a user-facing reply for a caught error, or returns `undefined` to send
 * nothing.
 *
 * @param exception - The caught error.
 * @param ctx - The Telegraf context for the failed update.
 * @returns The reply text, or `undefined` to stay silent.
 */
export type TelegramExceptionReplyFactory = (
  exception: unknown,
  ctx: Context,
) => string | undefined;

/** Configuration for {@link TelegramExceptionFilter}. */
export interface TelegramExceptionFilterOptions {
  /**
   * A user-facing message to send when a handler errors — a fixed string, or a
   * factory computing one (return `undefined` to send nothing). When omitted, no
   * reply is sent (the error is only logged).
   */
  readonly reply?: string | TelegramExceptionReplyFactory;
  /**
   * Logger to report caught errors through. Pass `false` to disable logging.
   * Defaults to a `Logger` scoped to the filter.
   */
  readonly logger?: LoggerService | false;
}

/**
 * Catch-all exception filter for Telegram updates: logs the error and optionally
 * replies to the user. Configure it as an instance, e.g.
 * `new TelegramExceptionFilter({ reply: '…' })`.
 */
@Injectable()
@Catch()
export class TelegramExceptionFilter implements TelegramFilter {
  /** Logger used for caught errors, or `undefined` when logging is disabled. */
  private readonly _logger: LoggerService | undefined;

  /** The configured reply (string/factory), or `undefined` for no reply. */
  private readonly _reply: string | TelegramExceptionReplyFactory | undefined;

  /**
   * @param options - Optional reply text/factory and logger override.
   */
  public constructor(options: TelegramExceptionFilterOptions = {}) {
    this._logger =
      options.logger === false
        ? undefined
        : (options.logger ?? new Logger(TelegramExceptionFilter.name));
    this._reply = options.reply;
  }

  /**
   * Handles a caught error: logs it, then optionally replies to the chat.
   *
   * @param exception - The caught error (narrowed before use).
   * @param host - The arguments host (a {@link TelegramExecutionContext}).
   * @returns Resolves once logging and any reply have been attempted.
   * @throws Never (a failed reply is logged, not propagated).
   */
  public async catch(exception: unknown, host: ArgumentsHost): Promise<void> {
    const ctx = TelegramExecutionContext.create(host).getContext();
    const message =
      exception instanceof Error ? exception.message : String(exception);
    this._logger?.error(`Unhandled Telegram update error: ${message}`);

    const replyText = this._resolveReply(exception, ctx);
    if (replyText === undefined) return;

    try {
      await ctx.reply(replyText);
    } catch (replyError) {
      // ── A reply can itself fail (blocked bot, bad chat) — never re-throw. ───
      const reason =
        replyError instanceof Error ? replyError.message : String(replyError);
      this._logger?.error(`Failed to send error reply to the user: ${reason}`);
    }
  }

  /**
   * Computes the reply text for a caught error from the configured option.
   *
   * @param exception - The caught error.
   * @param ctx - The Telegraf context for the failed update.
   * @returns The reply text, or `undefined` to send nothing.
   * @throws Never.
   */
  private _resolveReply(exception: unknown, ctx: Context): string | undefined {
    if (this._reply === undefined) return undefined;
    if (typeof this._reply === 'function') return this._reply(exception, ctx);
    return this._reply;
  }
}
