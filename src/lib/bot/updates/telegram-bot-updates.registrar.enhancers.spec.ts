/**
 * @file src/lib/bot/updates/telegram-bot-updates.registrar.enhancers.spec.ts
 *
 * PURPOSE
 * -------
 * Integration test proving the end-to-end enhancer path through the registrar: a
 * guard blocks an update, an interceptor wraps execution, and an exception filter
 * catches a thrown handler error — all wired via real Nest DI, with guard classes
 * resolved from the container. No network: the Telegraf instance is a recording
 * mock (mirroring `telegram-bot-updates.registrar.spec.ts`).
 */

import {
  Injectable,
  Logger,
  type ArgumentsHost,
  type CallHandler,
  type CanActivate,
  type ExceptionFilter,
  type ExecutionContext,
  type NestInterceptor,
} from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { tap, type Observable } from 'rxjs';
import type { Context, Telegraf } from 'telegraf';

import { TELEGRAM_BOT } from '../telegram-bot.constants';
import { TelegramBotModule } from '../telegram-bot.module';
import {
  UseTelegramFilters,
  UseTelegramGuards,
  UseTelegramInterceptors,
} from './execution/enhancer.decorators';
import { TelegramExecutionContext } from './execution/telegram-execution-context';
import { Ctx } from './param.decorators';
import { TelegramBotUpdatesRegistrar } from './telegram-bot-updates.registrar';
import { Command, TelegramUpdate, Use } from './telegram-update.decorator';

/** A recorded `Telegraf` registration: which method, optional trigger, the mw. */
interface Registration {
  method: string;
  trigger?: unknown;
  middleware: (ctx: Context, next: () => Promise<void>) => unknown;
}

/** Builds a mock Telegraf that records every handler registration. */
function createMockBot(): { bot: Telegraf; regs: Registration[] } {
  const regs: Registration[] = [];
  const withTrigger =
    (method: string) =>
    (trigger: unknown, middleware: Registration['middleware']): void => {
      regs.push({ method, trigger, middleware });
    };
  const noTrigger =
    (method: string) =>
    (middleware: Registration['middleware']): void => {
      regs.push({ method, middleware });
    };
  const bot = {
    start: jest.fn(noTrigger('start')),
    help: jest.fn(noTrigger('help')),
    use: jest.fn(noTrigger('use')),
    command: jest.fn(withTrigger('command')),
    hears: jest.fn(withTrigger('hears')),
    action: jest.fn(withTrigger('action')),
    on: jest.fn(withTrigger('on')),
  };
  return { bot: bot as unknown as Telegraf, regs };
}

// ── Module-level sinks the enhancers record into (reset per test). ────────────
/** Ordered interceptor pre/handler/post events. */
const interceptorEvents: string[] = [];
/** Errors captured by the recording filter, with the host they were given. */
const filterCaptures: Array<{ error: unknown; host: ArgumentsHost }> = [];

/** Guard (DI class ref) that always blocks. */
@Injectable()
class DenyGuard implements CanActivate {
  public canActivate(): boolean {
    return false;
  }
}

/** Guard (DI class ref) that always allows. */
@Injectable()
class AllowGuard implements CanActivate {
  public canActivate(): boolean {
    return true;
  }
}

/** Interceptor instance recording pre/post around the handler. */
class TraceInterceptor implements NestInterceptor {
  public intercept(
    _context: ExecutionContext,
    next: CallHandler,
  ): Observable<unknown> {
    interceptorEvents.push('pre');
    return next.handle().pipe(tap(() => interceptorEvents.push('post')));
  }
}

/** Filter instance recording the caught error and host. */
class RecordingFilter implements ExceptionFilter {
  public catch(error: unknown, host: ArgumentsHost): void {
    filterCaptures.push({ error, host });
  }
}

/** Provider exercising guard allow/deny via DI-resolved guard classes. */
@TelegramUpdate()
@Injectable()
class GuardedUpdate {
  /** Names of handlers that actually ran. */
  public readonly calls: string[] = [];

  @Command('blocked')
  @UseTelegramGuards(DenyGuard)
  public onBlocked(@Ctx() _ctx: Context): void {
    this.calls.push('blocked');
  }

  @Command('open')
  @UseTelegramGuards(AllowGuard)
  public onOpen(@Ctx() _ctx: Context): void {
    this.calls.push('open');
  }
}

/** Provider with a `@Use` middleware guarded by a denying guard. */
@TelegramUpdate()
@Injectable()
class UseDenyUpdate {
  /** Set true if the middleware body ran (it must not, under a deny guard). */
  public ran = false;

  @Use()
  @UseTelegramGuards(DenyGuard)
  public mw(@Ctx() _ctx: Context): void {
    this.ran = true;
  }
}

/** Provider with a `@Use` middleware guarded by an allowing guard. */
@TelegramUpdate()
@Injectable()
class UseAllowUpdate {
  /** Set true when the middleware body ran. */
  public ran = false;

  @Use()
  @UseTelegramGuards(AllowGuard)
  public mw(@Ctx() _ctx: Context): void {
    this.ran = true;
  }
}

/** Provider whose `@Use` middleware throws (error-isolation for middleware). */
@TelegramUpdate()
@Injectable()
class UseThrowingUpdate {
  @Use()
  public mw(@Ctx() _ctx: Context): void {
    throw new Error('middleware blew up');
  }
}

/** Base provider whose handler is guarded by a denying guard. */
@TelegramUpdate()
@Injectable()
class BaseGuardedUpdate {
  /** Names of handlers that actually ran. */
  public readonly calls: string[] = [];

  @Command('inherited')
  @UseTelegramGuards(DenyGuard)
  public onCmd(@Ctx() _ctx: Context): void {
    this.calls.push('base');
  }
}

/** Subclass overriding the guarded handler WITHOUT re-declaring the guard. */
@TelegramUpdate()
@Injectable()
class OverridingGuardedUpdate extends BaseGuardedUpdate {
  public override onCmd(_ctx: Context): void {
    this.calls.push('override');
  }
}

/** Provider whose handler is wrapped by an interceptor. */
@TelegramUpdate()
@Injectable()
class InterceptedUpdate {
  @Command('intercepted')
  @UseTelegramInterceptors(new TraceInterceptor())
  public onHit(@Ctx() _ctx: Context): void {
    interceptorEvents.push('handler');
  }
}

/** Provider whose handler throws, caught by a configured filter. */
@TelegramUpdate()
@Injectable()
class ThrowingUpdate {
  @Command('boom')
  @UseTelegramFilters(new RecordingFilter())
  public onBoom(@Ctx() _ctx: Context): void {
    throw new Error('handler blew up');
  }
}

/** Provider with an interceptor (non-fast-path) whose error has no filter. */
@TelegramUpdate()
@Injectable()
class UnfilteredThrowingUpdate {
  @Command('crash')
  @UseTelegramInterceptors(new TraceInterceptor())
  public onCrash(@Ctx() _ctx: Context): void {
    throw new Error('uncaught');
  }
}

/** Compiles the bot module over the mock and runs the registrar once. */
async function bootstrap(providers: ReadonlyArray<new () => object>): Promise<{
  regs: Registration[];
  get: <T>(token: new () => T) => T;
}> {
  const { bot, regs } = createMockBot();
  const moduleRef = await Test.createTestingModule({
    imports: [TelegramBotModule.forRoot({ token: 'x', launch: false })],
    providers: [...providers],
  })
    .overrideProvider(TELEGRAM_BOT)
    .useValue(bot)
    .compile();

  const registrar = moduleRef.get(TelegramBotUpdatesRegistrar, {
    strict: false,
  });
  registrar.onModuleInit();

  return { regs, get: (token) => moduleRef.get(token) };
}

/** Finds the recorded middleware for a `@Command(trigger)`. */
function commandFor(
  regs: Registration[],
  trigger: string,
): Registration['middleware'] {
  const reg = regs.find((r) => r.method === 'command' && r.trigger === trigger);
  if (!reg) throw new Error(`no command registered for "${trigger}"`);
  return reg.middleware;
}

/** Finds the single recorded `@Use` middleware. */
function useFor(regs: Registration[]): Registration['middleware'] {
  const reg = regs.find((r) => r.method === 'use');
  if (!reg) throw new Error('no @Use middleware registered');
  return reg.middleware;
}

/** Builds a throwaway context for dispatch. */
function fakeContext(): Context {
  return { reply: jest.fn() } as unknown as Context;
}

describe('TelegramBotUpdatesRegistrar enhancers (integration)', () => {
  let errorSpy: jest.SpyInstance;
  let debugSpy: jest.SpyInstance;
  const next = (): Promise<void> => Promise.resolve();

  beforeEach(() => {
    interceptorEvents.length = 0;
    filterCaptures.length = 0;
    errorSpy = jest
      .spyOn(Logger.prototype, 'error')
      .mockImplementation(() => undefined);
    debugSpy = jest
      .spyOn(Logger.prototype, 'debug')
      .mockImplementation(() => undefined);
  });

  afterEach(() => {
    errorSpy.mockRestore();
    debugSpy.mockRestore();
  });

  it('blocks an update when a (DI-resolved) guard denies it', async () => {
    const { regs, get } = await bootstrap([
      GuardedUpdate,
      DenyGuard,
      AllowGuard,
    ]);
    const update = get(GuardedUpdate);

    await commandFor(regs, 'blocked')(fakeContext(), next);

    expect(update.calls).not.toContain('blocked');
    // ── Denial is a debug event, not an error. ────────────────────────────────
    expect(errorSpy).not.toHaveBeenCalled();
    expect(debugSpy).toHaveBeenCalled();
  });

  it('does NOT continue the chain when a guard denies a @Use middleware', async () => {
    const { regs, get } = await bootstrap([UseDenyUpdate, DenyGuard, AllowGuard]);
    const update = get(UseDenyUpdate);
    const proceed = jest.fn().mockResolvedValue(undefined);

    await useFor(regs)(fakeContext(), proceed);

    expect(update.ran).toBe(false);
    expect(proceed).not.toHaveBeenCalled();
    expect(debugSpy).toHaveBeenCalled();
    expect(errorSpy).not.toHaveBeenCalled();
  });

  it('continues the chain when a guard allows a @Use middleware', async () => {
    const { regs, get } = await bootstrap([
      UseAllowUpdate,
      DenyGuard,
      AllowGuard,
    ]);
    const update = get(UseAllowUpdate);
    const proceed = jest.fn().mockResolvedValue(undefined);

    await useFor(regs)(fakeContext(), proceed);

    expect(update.ran).toBe(true);
    expect(proceed).toHaveBeenCalledTimes(1);
  });

  it('isolates a throwing @Use middleware and does NOT continue the chain', async () => {
    const { regs } = await bootstrap([UseThrowingUpdate]);
    const proceed = jest.fn().mockResolvedValue(undefined);

    await expect(useFor(regs)(fakeContext(), proceed)).resolves.toBeUndefined();
    expect(proceed).not.toHaveBeenCalled();
    expect(errorSpy).toHaveBeenCalled();
  });

  it('applies an inherited guard to an overridden handler', async () => {
    const { regs, get } = await bootstrap([
      OverridingGuardedUpdate,
      DenyGuard,
      AllowGuard,
    ]);
    const update = get(OverridingGuardedUpdate);

    await commandFor(regs, 'inherited')(fakeContext(), next);

    // ── The inherited DenyGuard still blocks; the override never ran. ──────────
    expect(update.calls).toEqual([]);
    expect(debugSpy).toHaveBeenCalled();
    expect(errorSpy).not.toHaveBeenCalled();
  });

  it('runs an update when the guard allows it', async () => {
    const { regs, get } = await bootstrap([
      GuardedUpdate,
      DenyGuard,
      AllowGuard,
    ]);
    const update = get(GuardedUpdate);

    await commandFor(regs, 'open')(fakeContext(), next);

    expect(update.calls).toEqual(['open']);
  });

  it('wraps the handler with an interceptor (pre → handler → post)', async () => {
    const { regs } = await bootstrap([InterceptedUpdate]);

    await commandFor(regs, 'intercepted')(fakeContext(), next);

    expect(interceptorEvents).toEqual(['pre', 'handler', 'post']);
  });

  it('routes a thrown handler error to the configured filter (not the logger)', async () => {
    const { regs } = await bootstrap([ThrowingUpdate]);

    await commandFor(regs, 'boom')(fakeContext(), next);

    expect(filterCaptures).toHaveLength(1);
    const capture = filterCaptures[0];
    expect((capture?.error as Error).message).toBe('handler blew up');
    // ── The host handed to the filter is a usable execution context. ──────────
    expect(capture?.host).toBeInstanceOf(TelegramExecutionContext);
    // ── Handled errors do not fall through to the registrar's error log. ──────
    expect(errorSpy).not.toHaveBeenCalled();
  });

  it('isolates and logs an enhanced handler error when no filter handles it', async () => {
    const { regs } = await bootstrap([UnfilteredThrowingUpdate]);

    // ── Resolves (never rethrows to Telegraf) and logs the failure. ───────────
    await expect(
      commandFor(regs, 'crash')(fakeContext(), next),
    ).resolves.toBeUndefined();
    expect(errorSpy).toHaveBeenCalledWith(expect.stringContaining('uncaught'));
  });
});
