/**
 * @file src/lib/testing/mock-telegraf.ts
 *
 * PURPOSE
 * -------
 * Public test seam for the runtime-reconfigurable bot. Builds a network-free fake
 * `Telegraf` whose handler-registration methods, `launch`/`stop`, and `telegram`
 * client are all `jest.fn()` spies, suitable as the
 * {@link import('../bot').TelegramBotRuntimeModuleOptions.botFactory} so a
 * {@link import('../bot').TelegramBotRuntime} can be configured/launched in unit
 * tests without ever opening a connection.
 *
 * By default `launch()` returns a promise that **never resolves** (mirroring real
 * long-polling, which only resolves once the bot stops) and `telegram.getMe()`
 * resolves a representative bot account. Override either per test to exercise the
 * error paths (a rejected `getMe` for a revoked token, or a rejected `launch` for
 * a single-poller `409` conflict).
 *
 * The `jest` reference is the ambient global a Jest runtime provides; this module
 * never `import`s `jest`, so `telenest/testing` adds no hard dependency on a test
 * runner. Call {@link createMockTelegraf} only from inside Jest specs.
 *
 * USAGE
 * -----
 * ```ts
 * import { TelegramBotModule, TelegramBotRuntime, InjectBotRuntime } from 'telenest';
 * import { createMockTelegraf } from 'telenest/testing';
 *
 * const moduleRef = await Test.createTestingModule({
 *   imports: [TelegramBotModule.forRootRuntime({ botFactory: () => createMockTelegraf() })],
 * }).compile();
 * const runtime = moduleRef.get(TelegramBotRuntime); // via getBotRuntimeToken()
 * await runtime.configure({ token: '123:abc' });
 * ```
 *
 * KEY EXPORTS
 * -----------
 * - createMockTelegraf: Builds a fully-spied, network-free fake `Telegraf`.
 * - MockTelegraf: The typed shape of that fake (exposes the spies for assertions).
 */

import type { Telegraf, Telegram } from 'telegraf';

/** The bot account shape `Telegram.getMe` resolves to (Telegraf's `BotUser`). */
type BotUser = Awaited<ReturnType<Telegram['getMe']>>;

/**
 * The spied surface of a {@link createMockTelegraf} fake. Every member is a
 * `jest.fn()`; `telegram` carries the two Bot API calls the runtime manager and
 * registrars make (`getMe` for token validation, `setMyCommands` for the menu).
 * Cast to `Telegraf` when handing it to the library; keep the `MockTelegraf` view
 * to assert against the spies.
 */
export interface MockTelegraf {
  /** `bot.start(...)` handler registration spy. */
  readonly start: jest.Mock;
  /** `bot.help(...)` handler registration spy. */
  readonly help: jest.Mock;
  /** `bot.use(...)` middleware registration spy. */
  readonly use: jest.Mock;
  /** `bot.command(...)` handler registration spy. */
  readonly command: jest.Mock;
  /** `bot.hears(...)` handler registration spy. */
  readonly hears: jest.Mock;
  /** `bot.action(...)` handler registration spy. */
  readonly action: jest.Mock;
  /** `bot.on(...)` handler registration spy. */
  readonly on: jest.Mock;
  /** `bot.inlineQuery(...)` handler registration spy. */
  readonly inlineQuery: jest.Mock;
  /** `bot.launch(...)` spy; resolves never by default (long-polling). */
  readonly launch: jest.Mock;
  /** `bot.stop(...)` spy. */
  readonly stop: jest.Mock;
  /** `bot.webhookCallback(...)` spy returning a no-op middleware. */
  readonly webhookCallback: jest.Mock;
  /** The fake `Telegram` client (`getMe` / `setMyCommands` spies). */
  readonly telegram: Pick<Telegram, 'getMe' | 'setMyCommands'>;
}

/**
 * Builds a representative bot account for the fake `getMe`.
 *
 * @param overrides - Per-test replacements for any subset of the bot user fields.
 * @returns A {@link BotUser} describing a mock bot.
 * @throws Never.
 */
function aMockBotUser(overrides: Partial<BotUser> = {}): BotUser {
  return {
    id: 424242,
    is_bot: true,
    first_name: 'Mock Bot',
    username: 'mock_bot',
    can_join_groups: true,
    can_read_all_group_messages: false,
    supports_inline_queries: false,
    ...overrides,
  };
}

/**
 * Builds a fully-spied, network-free fake `Telegraf` for runtime-bot tests. Every
 * handler-registration method, `launch`/`stop`, and the `telegram` client are
 * `jest.fn()` spies. Defaults: `launch()` returns a forever-pending promise
 * (mirroring long-polling, which resolves only on stop) and `telegram.getMe()`
 * resolves a representative bot account; `telegram.setMyCommands()` resolves
 * `true`. Pass `overrides` to replace any spy — e.g. a rejecting `getMe` (revoked
 * token) or a rejecting `launch` (single-poller `409`).
 *
 * @param overrides - Per-test replacements for any subset of the spied surface;
 *   `telegram` is shallow-merged so you can override just `getMe` or
 *   `setMyCommands`.
 * @returns A {@link MockTelegraf} you can hand to the library as a `Telegraf` (via
 *   {@link asTelegraf} or a direct cast) and assert against.
 * @throws {ReferenceError} If called outside a Jest runtime (no ambient `jest`).
 *
 * @example
 * ```ts
 * // Revoked token → configure() reports `error` status.
 * const bot = createMockTelegraf({
 *   telegram: { getMe: jest.fn().mockRejectedValue(new Error('401: Unauthorized')) },
 * });
 * ```
 */
export function createMockTelegraf(
  overrides: Partial<MockTelegraf> = {},
): MockTelegraf {
  const { telegram: telegramOverrides, ...rest } = overrides;
  const base: MockTelegraf = {
    start: jest.fn(),
    help: jest.fn(),
    use: jest.fn(),
    command: jest.fn(),
    hears: jest.fn(),
    action: jest.fn(),
    on: jest.fn(),
    inlineQuery: jest.fn(),
    // ── Long-polling never resolves until the bot stops; model that with a
    //    forever-pending promise so the manager treats launch as "running". ─────
    launch: jest.fn().mockReturnValue(new Promise<void>(() => undefined)),
    stop: jest.fn(),
    webhookCallback: jest.fn().mockReturnValue(() => undefined),
    telegram: {
      getMe: jest.fn().mockResolvedValue(aMockBotUser()),
      setMyCommands: jest.fn().mockResolvedValue(true),
      ...telegramOverrides,
    },
    ...rest,
  };
  return base;
}

/**
 * Narrows a {@link MockTelegraf} to the `Telegraf` type the library expects,
 * isolating the unavoidable cast (the fake implements only the slice the runtime
 * bot exercises) behind one documented helper.
 *
 * @param mock - The fake produced by {@link createMockTelegraf}.
 * @returns The same object typed as a `Telegraf`.
 * @throws Never.
 */
export function asTelegraf(mock: MockTelegraf): Telegraf {
  return mock as unknown as Telegraf;
}
