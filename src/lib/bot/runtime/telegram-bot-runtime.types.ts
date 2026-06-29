/**
 * @file src/lib/bot/runtime/telegram-bot-runtime.types.ts
 *
 * PURPOSE
 * -------
 * Public types for the runtime-reconfigurable bot: the lifecycle status union,
 * the immutable status snapshot {@link TelegramBotRuntime.getStatus} returns, the
 * options accepted by `TelegramBotModule.forRootRuntime`, and the per-`configure`
 * override shape. These describe a bot whose token is supplied (and may be
 * rotated or cleared) **after** application bootstrap, rather than fixed at
 * `forRoot` time.
 *
 * USAGE
 * -----
 * ```ts
 * TelegramBotModule.forRootRuntime({ isGlobal: true });
 * // later, in a service:
 * await runtime.configure({ token: tokenFromDb });
 * const { status } = runtime.getStatus();
 * ```
 *
 * KEY EXPORTS
 * -----------
 * - BOT_RUNTIME_STATUSES / BotRuntimeStatus: the closed lifecycle-status set.
 * - TelegramBotRuntimeStatus: the snapshot returned by `getStatus()`.
 * - TelegramBotRuntimeModuleOptions: `forRootRuntime` configuration (no token).
 * - TelegramBotRuntimeConfigureOptions: per-`configure` token + overrides.
 * - TelegramBotFactory: test seam for building the `Telegraf` instance.
 */

import type { Context, Telegraf } from 'telegraf';

import type { TelegramMetricsRecorder } from '../../common';
import type {
  TelegramBotCommandsOptions,
  TelegramBotScenesOptions,
} from '../telegram-bot.options';

/**
 * The closed set of runtime-bot lifecycle states. Modeled as an `as const`
 * record (never a TS `enum`) with a derived union, per the project's conventions.
 *
 * - `offline` — no token configured (or it was stopped/cleared); not polling.
 * - `online` — a token is configured and the bot has been launched.
 * - `error` — the last `configure`/launch attempt failed (bad/revoked token,
 *   a single-poller `409` conflict, or a launch error). The app keeps running.
 */
export const BOT_RUNTIME_STATUSES = {
  /** No token configured, or the bot was stopped/cleared; not polling. */
  OFFLINE: 'offline',
  /** A token is configured and the bot is launched (polling or webhook). */
  ONLINE: 'online',
  /** The last (re)configure or launch failed; see {@link TelegramBotRuntimeStatus.lastError}. */
  ERROR: 'error',
} as const;

/** A runtime-bot lifecycle status — one of {@link BOT_RUNTIME_STATUSES}. */
export type BotRuntimeStatus =
  (typeof BOT_RUNTIME_STATUSES)[keyof typeof BOT_RUNTIME_STATUSES];

/** All runtime-bot statuses as a readonly array (for validation/iteration). */
export const BOT_RUNTIME_STATUS_VALUES = Object.values(
  BOT_RUNTIME_STATUSES,
) as readonly BotRuntimeStatus[];

/**
 * Immutable snapshot of a runtime bot's current state, returned by
 * {@link TelegramBotRuntime.getStatus}. Safe to expose from an admin/status
 * endpoint: it never carries the token.
 */
export interface TelegramBotRuntimeStatus {
  /** The current lifecycle status. */
  readonly status: BotRuntimeStatus;

  /**
   * The configured bot's `@username` (without the leading `@`), resolved from
   * `getMe` during the last successful `configure`. `undefined` when offline or
   * when the token could never be validated.
   */
  readonly botUsername?: string;

  /**
   * Human-readable description of the last failure, set when {@link status} is
   * `error` (e.g. an invalid-token `401` or a single-poller `409` conflict).
   * Cleared on the next successful `configure`. Never contains the token.
   */
  readonly lastError?: string;
}

/**
 * Factory that builds the `Telegraf` instance for a runtime bot from the merged
 * options. Supply one via {@link TelegramBotRuntimeModuleOptions.botFactory} to
 * replace the real Telegraf — primarily so unit tests never hit the network.
 * Defaults to {@link import('../telegram-bot.factory').createTelegrafInstance}.
 *
 * @param options - The merged module + per-`configure` options (carries `token`).
 * @returns A constructed (but not yet launched) `Telegraf` instance.
 */
export type TelegramBotFactory = (options: {
  /** The bot token resolved at runtime. */
  token: string;
  /** Options forwarded to the `Telegraf` constructor. */
  telegraf?: Partial<Telegraf.Options<Context>>;
}) => Telegraf;

/**
 * Configuration for `TelegramBotModule.forRootRuntime` — the same surface as the
 * static {@link import('../telegram-bot.options').TelegramBotModuleOptions} **minus
 * `token`** (which arrives later, at {@link TelegramBotRuntime.configure} time),
 * plus an optional {@link TelegramBotFactory} test seam.
 *
 * All fields are baseline defaults: each {@link TelegramBotRuntime.configure} call
 * merges its own overrides on top of these.
 */
export interface TelegramBotRuntimeModuleOptions {
  /**
   * Options forwarded verbatim to the `Telegraf` constructor each time the bot is
   * built (handler timeout, custom `telegram` agent/test environment, etc.).
   */
  telegraf?: Partial<Telegraf.Options<Context>>;

  /**
   * Launch options forwarded to `bot.launch()` on each `configure`. Omit for
   * long-polling; supply a `webhook` block to run in webhook mode. Ignored when
   * {@link TelegramBotRuntimeModuleOptions.launch} is `false`.
   */
  launchOptions?: Telegraf.LaunchOptions;

  /**
   * Whether `configure` should automatically launch the bot after (re)building
   * and binding it. Defaults to `true`. Set to `false` to take manual control of
   * launch (e.g. webhook deployments that mount the callback themselves) — the
   * bot is still built, validated via `getMe`, and its handlers bound.
   */
  launch?: boolean;

  /**
   * Command-menu auto-registration settings, applied on each `configure`. Opt-in
   * via `commands: { autoRegister: true }` to sync the Telegram command menu from
   * `@Command(name, { description })` metadata after each (re)launch.
   */
  commands?: TelegramBotCommandsOptions;

  /**
   * Scene & wizard subsystem settings, applied on each `configure`. Scenes are
   * discovered and re-bound onto every freshly built instance; this only controls
   * the auto-registered session middleware (`scenes: { session: false }`).
   */
  scenes?: TelegramBotScenesOptions;

  /**
   * Metrics recorder for this bot's counters. Defaults to a fresh in-memory
   * recorder. Supply a custom recorder to export the counters elsewhere.
   */
  metrics?: TelegramMetricsRecorder;

  /**
   * Test seam: a factory that builds the `Telegraf` instance instead of the real
   * {@link import('../telegram-bot.factory').createTelegrafInstance}. Supply a
   * fake (e.g. {@link import('../../testing').createMockTelegraf}) so unit tests
   * never open a network connection.
   */
  botFactory?: TelegramBotFactory;
}

/**
 * The shape accepted by `TelegramBotModule.forRootRuntime`: the baseline
 * {@link TelegramBotRuntimeModuleOptions} plus the synchronous `isGlobal` / `name`
 * extras (the same extras the static `forRoot` accepts). `name` registers one of
 * several runtime bots; omit it for the single default runtime bot.
 */
export interface TelegramBotRuntimeForRootOptions extends TelegramBotRuntimeModuleOptions {
  /** When `true`, the runtime bot's providers are registered globally. */
  isGlobal?: boolean;

  /**
   * Registers this runtime bot under a name so several bots (runtime and static)
   * can coexist. Omit for the single default runtime bot. Inject it with
   * `@InjectBotRuntime(name)` and scope handlers with `@TelegramUpdate({ bot: name })`.
   */
  name?: string;
}

/**
 * Per-`configure` options: the runtime token plus optional one-off overrides of a
 * subset of {@link TelegramBotRuntimeModuleOptions}. Anything omitted falls back
 * to the module-level baseline supplied at `forRootRuntime`.
 */
export interface TelegramBotRuntimeConfigureOptions {
  /**
   * The Bot API token to (re)build the bot with. Required. An empty/blank token
   * is treated as a misconfiguration: the bot moves to `error` status rather than
   * throwing (use {@link TelegramBotRuntime.clear} to intentionally go offline).
   */
  token: string;

  /** Overrides {@link TelegramBotRuntimeModuleOptions.telegraf} for this build. */
  telegraf?: Partial<Telegraf.Options<Context>>;

  /** Overrides {@link TelegramBotRuntimeModuleOptions.launchOptions} for this build. */
  launchOptions?: Telegraf.LaunchOptions;

  /** Overrides {@link TelegramBotRuntimeModuleOptions.launch} for this build. */
  launch?: boolean;
}
