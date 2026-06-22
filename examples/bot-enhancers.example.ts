/**
 * @file examples/bot-enhancers.example.ts
 *
 * PURPOSE
 * -------
 * A copy-paste reference for the Bot API **enhancer** system — guards,
 * interceptors, and exception filters around `@TelegramUpdate` handlers. It shows
 * the `@UseTelegramGuards` / `@UseTelegramInterceptors` / `@UseTelegramFilters`
 * decorators at both class and method level, the built-in allowlist/rate-limit
 * guards and default exception filter, a custom guard and a custom interceptor,
 * and how class refs participate in DI.
 *
 * This file is illustrative — it is not part of the published package — but it is
 * type-checked (see tsconfig `include`) so it never drifts from the API.
 *
 * USAGE
 * -----
 * Adapt `EnhancerBotExampleModule` into your own app, then `app.init()` as usual.
 *
 * KEY EXPORTS
 * -----------
 * - HasUsernameGuard: a custom guard (class ref, resolved via DI).
 * - TimingInterceptor: a custom interceptor (class ref, resolved via DI).
 * - AdminUpdate: a decorated update provider wearing class- and method-level enhancers.
 * - EnhancerBotExampleModule: wires TelegramBotModule + the handler + DI enhancers.
 */

import {
  Injectable,
  Logger,
  Module,
  type CallHandler,
  type CanActivate,
  type ExecutionContext,
  type NestInterceptor,
} from '@nestjs/common';
import { tap, type Observable } from 'rxjs';
import type { Context } from 'telegraf';
import {
  ChatAllowlistGuard,
  Command,
  Ctx,
  RateLimitGuard,
  TelegramBotModule,
  TelegramExceptionFilter,
  TelegramExecutionContext,
  TelegramUpdate,
  UseTelegramFilters,
  UseTelegramGuards,
  UseTelegramInterceptors,
  type TelegramGuard,
} from '../src';

/** Numeric chat ID this example restricts the bot to (replace with your own). */
const SUPPORT_CHAT_ID = -1001234567890;

/**
 * A custom guard allowing only senders who have a public `@username`. Resolved
 * from the DI container because it is referenced by class (see the module).
 */
@Injectable()
export class HasUsernameGuard implements TelegramGuard {
  /**
   * @param context - The execution context for the current update.
   * @returns `true` when the sender has a username, else `false`.
   * @throws Never.
   */
  public canActivate(context: ExecutionContext): boolean {
    const ctx = TelegramExecutionContext.create(context).getContext();
    return Boolean(ctx.from?.username);
  }
}

/**
 * A custom interceptor logging how long each handler takes. Resolved from the DI
 * container (class ref), so it gets a normal injected `Logger`-style lifecycle.
 */
@Injectable()
export class TimingInterceptor implements NestInterceptor {
  /** Logger scoped to the interceptor. */
  private readonly _logger = new Logger(TimingInterceptor.name);

  /**
   * @param context - The execution context for the current update.
   * @param next - The downstream handler stream.
   * @returns The handler stream with a timing side effect on completion.
   * @throws Never.
   */
  public intercept(
    context: ExecutionContext,
    next: CallHandler,
  ): Observable<unknown> {
    const ctx = TelegramExecutionContext.create(context).getContext();
    const startedAt = Date.now();
    return next.handle().pipe(
      tap(() =>
        this._logger.debug(
          `update ${ctx.updateType} handled in ${Date.now() - startedAt}ms`,
        ),
      ),
    );
  }
}

/**
 * Update provider demonstrating enhancers. Class-level enhancers apply to every
 * handler; method-level enhancers stack on top for a single command.
 */
@TelegramUpdate()
@Injectable()
// ── Class-level: restrict the whole class to the support chat, time every
//    handler, and reply nicely on any unhandled error. ────────────────────────
@UseTelegramGuards(new ChatAllowlistGuard({ allow: [SUPPORT_CHAT_ID] }))
@UseTelegramInterceptors(TimingInterceptor)
@UseTelegramFilters(
  new TelegramExceptionFilter({ reply: 'Sorry — something went wrong.' }),
)
export class AdminUpdate {
  /**
   * `/whoami` — additionally require a username and throttle per chat.
   *
   * @param ctx - The Telegraf context for the update.
   * @returns Resolves once the reply is sent.
   * @throws Never (errors surface to the class-level filter).
   */
  @Command('whoami')
  @UseTelegramGuards(
    HasUsernameGuard,
    new RateLimitGuard({ capacity: 3, refillPerInterval: 1, intervalMs: 1000 }),
  )
  public async onWhoami(@Ctx() ctx: Context): Promise<void> {
    await ctx.reply(`You are @${ctx.from?.username}.`);
  }
}

/**
 * Wires `TelegramBotModule` with the decorated handler and the DI-resolved
 * enhancer classes (`HasUsernameGuard`, `TimingInterceptor`). Built-in guards and
 * the filter are passed as configured instances, so they need no registration.
 */
@Module({
  imports: [TelegramBotModule.forRoot({ token: process.env.BOT_TOKEN ?? '' })],
  providers: [AdminUpdate, HasUsernameGuard, TimingInterceptor],
})
export class EnhancerBotExampleModule {}
