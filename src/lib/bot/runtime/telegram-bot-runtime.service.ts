/**
 * @file src/lib/bot/runtime/telegram-bot-runtime.service.ts
 *
 * PURPOSE
 * -------
 * Injectable manager for a **runtime-reconfigurable bot**: a bot whose token is
 * supplied (and may be rotated or cleared) *after* application bootstrap rather
 * than fixed at `forRoot` time. It builds, (re)binds, launches, and stops a
 * `Telegraf` instance on demand — the upstreamed equivalent of a hand-rolled
 * "runtime bot manager" — reusing telenest's existing factory and discovery-based
 * handler/scene registrars so decorator handlers, guards, interceptors, filters,
 * and scenes re-bind onto each freshly built instance.
 *
 * It never throws on a bad token: a missing encryption key, a revoked token, or a
 * single-poller `409` conflict moves the bot to `error` status (with a readable
 * `lastError`) and leaves the host application running.
 *
 * USAGE
 * -----
 * ```ts
 * @Injectable()
 * class TokenWiring {
 *   constructor(@InjectBotRuntime() private readonly bot: TelegramBotRuntime) {}
 *
 *   async onTokenSaved(token: string) {
 *     await this.bot.configure({ token }); // build (or rebuild) + bind + launch
 *   }
 *   async onTokenRemoved() {
 *     await this.bot.clear();              // stop + drop instance → offline
 *   }
 * }
 * ```
 *
 * KEY EXPORTS
 * -----------
 * - TelegramBotRuntime: the runtime bot lifecycle manager described above.
 */

import {
  Injectable,
  Logger,
  type OnApplicationShutdown,
  type OnModuleDestroy,
} from '@nestjs/common';
import { DiscoveryService, MetadataScanner, Reflector } from '@nestjs/core';
import type { Telegraf, Telegram } from 'telegraf';

import {
  TelegramConfigError,
  type TelegramMetricsRecorder,
  type TelegramTracer,
} from '../../common';
import { TelegramBotScenesRegistrar } from '../scenes/telegram-bot-scenes.registrar';
import { DEFAULT_BOT_NAME } from '../telegram-bot.constants';
import { createTelegrafInstance } from '../telegram-bot.factory';
import type { TelegramBotModuleOptions } from '../telegram-bot.options';
import { TelegramBotService } from '../telegram-bot.service';
import { TelegramEnhancerResolver } from '../updates/execution/telegram-enhancer.resolver';
import { TelegramBotUpdatesRegistrar } from '../updates/telegram-bot-updates.registrar';
import {
  BOT_RUNTIME_STATUSES,
  type BotRuntimeStatus,
  type TelegramBotFactory,
  type TelegramBotRuntimeConfigureOptions,
  type TelegramBotRuntimeModuleOptions,
  type TelegramBotRuntimeStatus,
} from './telegram-bot-runtime.types';

/**
 * Detects whether a launch rejection is Telegram's single-poller `409` conflict
 * ("terminated by other getUpdates request") so it can be surfaced as an
 * actionable status rather than an opaque error. Telegraf bubbles the Bot API
 * error text up in the message, sometimes alongside a numeric `409` code.
 *
 * @param error - The unknown value a `bot.launch()` promise rejected with.
 * @returns `true` when the failure is a single-poller `409` conflict.
 * @throws Never.
 */
function isSinglePollerConflict(error: unknown): boolean {
  const message = (
    error instanceof Error ? error.message : String(error)
  ).toLowerCase();
  // ── Probe a numeric `error_code`/`code` of 409 without assuming `any`. ────────
  let code: number | undefined;
  if (typeof error === 'object' && error !== null) {
    const candidate = error as {
      code?: unknown;
      response?: { error_code?: unknown };
    };
    if (typeof candidate.code === 'number') code = candidate.code;
    else if (typeof candidate.response?.error_code === 'number')
      code = candidate.response.error_code;
  }
  return (
    code === 409 ||
    message.includes('409') ||
    message.includes('terminated by other getupdates') ||
    message.includes('conflict')
  );
}

/**
 * Manages the lifecycle of a single runtime-reconfigurable bot. One instance is
 * created per `forRootRuntime` registration (default or named), constructed by
 * the module's factory provider — never as a plain class provider — so the bot
 * name and discovery dependencies are passed explicitly.
 *
 * All mutating operations ({@link configure}, {@link setToken}, {@link stop},
 * {@link clear}) are serialized through an internal queue so a stop never races a
 * concurrent rebuild, keeping each (re)configuration atomic.
 */
@Injectable()
export class TelegramBotRuntime
  implements OnModuleDestroy, OnApplicationShutdown
{
  /** Logger scoped to the manager (annotated with the bot name when named). */
  private readonly _logger: Logger;

  /** The factory that builds each `Telegraf` instance (test seam). */
  private readonly _botFactory: TelegramBotFactory;

  /** The currently configured `Telegraf`, or `null` when offline/cleared. */
  private _bot: Telegraf | null = null;

  /** Typed facade over {@link _bot}, rebuilt on each `configure`; `null` when none. */
  private _service: TelegramBotService | null = null;

  /**
   * The update registrar bound to the current instance, retained so its
   * `@Command` menu can be synced after (re)launch. `null` when offline.
   */
  private _updatesRegistrar: TelegramBotUpdatesRegistrar | null = null;

  /** Whether {@link _bot} has been launched (so stop is idempotent). */
  private _launched = false;

  /** The current lifecycle status. */
  private _status: BotRuntimeStatus = BOT_RUNTIME_STATUSES.OFFLINE;

  /** The configured bot's `@username`, resolved from `getMe`; `undefined` if none. */
  private _botUsername: string | undefined;

  /** The last failure message, set when {@link _status} is `error`. */
  private _lastError: string | undefined;

  /** Serializes mutating operations so rebuilds and stops never interleave. */
  private _lock: Promise<unknown> = Promise.resolve();

  /**
   * @param _name - Name of the bot this manager serves (`DEFAULT_BOT_NAME` for the
   *   default bot); only `@TelegramUpdate({ bot })` providers whose target bot
   *   matches are bound onto each rebuilt instance.
   * @param _baseOptions - Baseline options from `forRootRuntime`; each
   *   {@link configure} call merges its overrides on top of these.
   * @param _discovery - Enumerates the application's providers (handler discovery).
   * @param _scanner - Lists method names on a provider prototype.
   * @param _reflector - Reads decorator metadata off classes and methods.
   * @param _enhancers - Resolves a handler's guard/interceptor/filter refs.
   * @param _metrics - Metrics sink threaded into each rebuilt facade.
   * @param _tracer - Tracer threaded into each rebuilt facade.
   */
  public constructor(
    private readonly _name: string,
    private readonly _baseOptions: TelegramBotRuntimeModuleOptions,
    private readonly _discovery: DiscoveryService,
    private readonly _scanner: MetadataScanner,
    private readonly _reflector: Reflector,
    private readonly _enhancers: TelegramEnhancerResolver,
    private readonly _metrics: TelegramMetricsRecorder,
    private readonly _tracer: TelegramTracer,
  ) {
    this._logger = new Logger(
      _name === DEFAULT_BOT_NAME
        ? TelegramBotRuntime.name
        : `${TelegramBotRuntime.name}[${_name}]`,
    );
    this._botFactory =
      _baseOptions.botFactory ??
      ((options): Telegraf => createTelegrafInstance(options));
  }

  // ── Lifecycle ───────────────────────────────────────────────────────────────

  /**
   * Stops the bot when its module is destroyed (`app.close()`), so a configured
   * runtime bot is always torn down cleanly. Idempotent.
   *
   * @returns A promise that resolves once the bot has been asked to stop.
   * @throws Never.
   */
  public async onModuleDestroy(): Promise<void> {
    await this.stop('module destroy');
  }

  /**
   * Stops the bot on application shutdown.
   *
   * @param signal - The OS signal that triggered shutdown, if any.
   * @returns A promise that resolves once the bot has been asked to stop.
   * @throws Never.
   */
  public async onApplicationShutdown(signal?: string): Promise<void> {
    await this.stop(signal);
  }

  // ── Public API ──────────────────────────────────────────────────────────────

  /**
   * Builds (or rebuilds) the bot from the supplied token and overrides, re-binds
   * every discovered handler/guard/scene onto the fresh instance, validates the
   * token via `getMe`, and launches it (unless `launch` is `false`). Atomic: any
   * previously running instance is stopped first, and the whole operation is
   * serialized against other mutating calls.
   *
   * Never throws on a bad token or launch failure: a blank/revoked token, a
   * `getMe` rejection, or a single-poller `409` conflict moves the bot to `error`
   * status with a readable {@link TelegramBotRuntimeStatus.lastError}, leaving the
   * application running.
   *
   * @param options - The runtime token plus optional per-build overrides.
   * @returns The resulting status snapshot (`online` on success, else `error`).
   * @throws Never.
   *
   * @example
   * ```ts
   * const { status, botUsername } = await runtime.configure({ token });
   * if (status === 'error') logger.warn(runtime.getStatus().lastError);
   * ```
   */
  public configure(
    options: TelegramBotRuntimeConfigureOptions,
  ): Promise<TelegramBotRuntimeStatus> {
    return this.serialize(() => this.doConfigure(options));
  }

  /**
   * Convenience wrapper over {@link configure} for the common "just set the token"
   * case; equivalent to `configure({ token })` with no per-build overrides.
   *
   * @param token - The Bot API token to (re)build the bot with.
   * @returns The resulting status snapshot.
   * @throws Never.
   */
  public setToken(token: string): Promise<TelegramBotRuntimeStatus> {
    return this.configure({ token });
  }

  /**
   * Stops the bot's poller (or webhook) but **keeps** the built instance, so
   * {@link instance}/{@link telegram}/{@link service} remain usable for one-off
   * API calls. Moves the status to `offline`. A no-op when not configured.
   *
   * @param reason - Optional human-readable reason recorded in logs.
   * @returns The resulting (`offline`) status snapshot.
   * @throws Never.
   */
  public stop(reason?: string): Promise<TelegramBotRuntimeStatus> {
    return this.serialize(() => {
      this.stopPolling(reason);
      // ── Keep the instance/facade; only the poller is stopped. ────────────────
      if (this._bot) this._status = BOT_RUNTIME_STATUSES.OFFLINE;
      return Promise.resolve(this.getStatus());
    });
  }

  /**
   * Stops the bot **and drops** the built instance and facade, returning to a
   * fully unconfigured state (`offline`). After this, {@link instance} /
   * {@link telegram} / {@link service} throw until the next {@link configure}.
   *
   * @returns The resulting (`offline`) status snapshot.
   * @throws Never.
   */
  public clear(): Promise<TelegramBotRuntimeStatus> {
    return this.serialize(() => {
      this.stopPolling('clear');
      this._bot = null;
      this._service = null;
      this._updatesRegistrar = null;
      this._botUsername = undefined;
      this._lastError = undefined;
      this._status = BOT_RUNTIME_STATUSES.OFFLINE;
      this._logger.log('Runtime bot cleared (offline).');
      return Promise.resolve(this.getStatus());
    });
  }

  /**
   * Returns an immutable snapshot of the current state. Safe to expose from a
   * status endpoint — it never carries the token.
   *
   * @returns The current {@link TelegramBotRuntimeStatus}.
   * @throws Never.
   */
  public getStatus(): TelegramBotRuntimeStatus {
    return {
      status: this._status,
      ...(this._botUsername !== undefined && {
        botUsername: this._botUsername,
      }),
      ...(this._lastError !== undefined && { lastError: this._lastError }),
    };
  }

  /** Whether a `Telegraf` instance is currently built (regardless of polling). */
  public get isConfigured(): boolean {
    return this._bot !== null;
  }

  // ── Raw accessors (throw a clear error when not configured) ──────────────────

  /**
   * The current raw `Telegraf` instance.
   *
   * @returns The built `Telegraf`.
   * @throws {TelegramConfigError} If no token is configured yet.
   */
  public get instance(): Telegraf {
    return this.requireBot();
  }

  /**
   * The current raw Telegraf `Telegram` client (the full Bot API surface).
   *
   * @returns The `Telegram` client of the built instance.
   * @throws {TelegramConfigError} If no token is configured yet.
   */
  public get telegram(): Telegram {
    return this.requireBot().telegram;
  }

  /**
   * The typed {@link TelegramBotService} facade over the current instance
   * (`sendMessage`, `getMe`, retries, callback-data codecs, …). Rebuilt on every
   * {@link configure}, so it always points at the live instance.
   *
   * @returns The facade bound to the current instance.
   * @throws {TelegramConfigError} If no token is configured yet.
   */
  public get service(): TelegramBotService {
    if (this._service === null)
      throw new TelegramConfigError(
        `Runtime bot "${this._name}" is not configured; call configure({ token }) first.`,
      );
    return this._service;
  }

  // ── Internals ────────────────────────────────────────────────────────────────

  /**
   * Performs one (re)configuration: stop the old instance, build a fresh one,
   * re-bind handlers/scenes, validate the token, then launch and sync commands.
   * Runs inside the serialization lock (via {@link configure}).
   *
   * @param options - The runtime token plus optional per-build overrides.
   * @returns The resulting status snapshot.
   * @throws Never (all failures are captured as `error` status).
   */
  private async doConfigure(
    options: TelegramBotRuntimeConfigureOptions,
  ): Promise<TelegramBotRuntimeStatus> {
    // ── Tear down any running instance first so the rebuild is clean (no leaked
    //    poller, no two getUpdates pollers from the same token). ────────────────
    this.stopPolling('reconfigure');

    // ── Guard the token here (not only in the factory) so a blank token is a
    //    consistent `error` even when a custom `botFactory` test seam is used. ──
    if (!options.token || options.token.trim().length === 0) {
      this.toErrorStatus(
        new TelegramConfigError(
          `Runtime bot "${this._name}" requires a non-empty token.`,
        ),
        'configure',
      );
      return this.getStatus();
    }

    const merged = this.mergeOptions(options);
    try {
      // ── Build → bind handlers/scenes → wrap in the typed facade. ─────────────
      const bot = this._botFactory({
        token: merged.token,
        ...(merged.telegraf !== undefined && { telegraf: merged.telegraf }),
      });
      const scenes = new TelegramBotScenesRegistrar(
        this._name,
        this._discovery,
        this._scanner,
        this._reflector,
        this._enhancers,
        bot,
        merged,
      );
      const updates = new TelegramBotUpdatesRegistrar(
        this._name,
        this._discovery,
        this._scanner,
        this._reflector,
        this._enhancers,
        bot,
        merged,
        scenes,
      );
      // ── Re-run the exact bootstrap binding the static path uses, but against
      //    this freshly built instance: @Use middleware, scenes, then handlers. ─
      updates.onModuleInit();
      const service = new TelegramBotService(
        bot,
        merged,
        this._metrics,
        this._tracer,
      );

      // ── Validate the token (and capture the username) before going live. A
      //    revoked/invalid token rejects here and is reported as `error`. ───────
      const me = await bot.telegram.getMe();

      this._bot = bot;
      this._service = service;
      this._updatesRegistrar = updates;
      this._botUsername = me.username;
      this._lastError = undefined;
      // ── Optimistically online *before* launching: a non-awaited launch
      //    failure (e.g. 409) flips to `error` on a later microtask, and that
      //    must not be clobbered by setting `online` again after the await. ─────
      this._status = BOT_RUNTIME_STATUSES.ONLINE;

      // ── Launch (unless disabled). Long-polling never resolves, so the launch
      //    promise is not awaited; a later failure (e.g. 409) flips to `error`. ─
      if (merged.launch !== false) this.launchInternal(bot, merged);

      // ── Sync the @Command menu (opt-in) the same way bootstrap does. This
      //    helper never throws — a menu sync failure must not fail configure. ───
      await updates.onApplicationBootstrap();

      this._logger.log(
        `Runtime bot "${this._name}" configured as @${
          me.username ?? 'unknown'
        } (status: ${this._status}).`,
      );
    } catch (error) {
      this.toErrorStatus(error, 'configure');
    }
    return this.getStatus();
  }

  /**
   * Starts long-polling (or webhook) for a freshly built instance without
   * awaiting the never-resolving poll loop. A launch rejection — most notably a
   * single-poller `409` conflict — flips the manager to `error` status.
   *
   * @param bot - The instance to launch (the current {@link _bot}).
   * @param options - The merged options carrying `launchOptions`.
   * @returns Nothing.
   * @throws Never.
   */
  private launchInternal(
    bot: Telegraf,
    options: TelegramBotModuleOptions,
  ): void {
    this._launched = true;
    const mode = options.launchOptions?.webhook ? 'webhook' : 'long-polling';
    this._logger.log(`Launching runtime bot "${this._name}" in ${mode} mode.`);
    // ── Telegraf's launch overload rejects `undefined`; omit the arg when no
    //    launch options are set, mirroring TelegramBotService.launch. ───────────
    const launchOptions = options.launchOptions;
    const launching = launchOptions ? bot.launch(launchOptions) : bot.launch();
    void launching.catch((error: unknown) => {
      // ── Only the *current* instance's failure matters; a stale instance that
      //    was already replaced/cleared must not clobber a healthy status. ──────
      if (this._bot !== bot) return;
      this._launched = false;
      const conflict = isSinglePollerConflict(error);
      const detail = error instanceof Error ? error.message : String(error);
      this._lastError = conflict
        ? `Another poller is already running for this bot (409 conflict): ${detail}`
        : `Bot launch failed: ${detail}`;
      this._status = BOT_RUNTIME_STATUSES.ERROR;
      this._logger.error(this._lastError);
    });
  }

  /**
   * Stops the current instance's poller if it is running, swallowing Telegraf's
   * benign "Bot is not running!" race. Leaves {@link _bot} in place.
   *
   * @param reason - Optional human-readable reason recorded in logs.
   * @returns Nothing.
   * @throws Never.
   */
  private stopPolling(reason?: string): void {
    if (!this._bot || !this._launched) return;
    this._launched = false;
    this._logger.log(
      `Stopping runtime bot "${this._name}"${reason ? ` (${reason})` : ''}.`,
    );
    try {
      this._bot.stop(reason);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      this._logger.warn(`Ignoring runtime bot stop error: ${message}`);
    }
  }

  /**
   * Merges the per-`configure` overrides on top of the module baseline into the
   * {@link TelegramBotModuleOptions} the factory and registrars consume.
   *
   * @param options - The per-`configure` token and overrides.
   * @returns The merged options (always carrying `token`).
   * @throws Never.
   */
  private mergeOptions(
    options: TelegramBotRuntimeConfigureOptions,
  ): TelegramBotModuleOptions {
    const base = this._baseOptions;
    const telegraf = options.telegraf ?? base.telegraf;
    const launchOptions = options.launchOptions ?? base.launchOptions;
    const launch = options.launch ?? base.launch;
    return {
      token: options.token,
      ...(telegraf !== undefined && { telegraf }),
      ...(launchOptions !== undefined && { launchOptions }),
      ...(launch !== undefined && { launch }),
      ...(base.commands !== undefined && { commands: base.commands }),
      ...(base.scenes !== undefined && { scenes: base.scenes }),
      ...(base.metrics !== undefined && { metrics: base.metrics }),
    };
  }

  /**
   * Records a captured failure as `error` status with a readable message, and
   * drops any half-built instance so the accessors report "not configured".
   *
   * @param error - The captured failure.
   * @param phase - The operation that failed (for the log line).
   * @returns Nothing.
   * @throws Never.
   */
  private toErrorStatus(error: unknown, phase: string): void {
    const detail = error instanceof Error ? error.message : String(error);
    this._bot = null;
    this._service = null;
    this._updatesRegistrar = null;
    this._launched = false;
    this._lastError = detail;
    this._status = BOT_RUNTIME_STATUSES.ERROR;
    this._logger.error(
      `Runtime bot "${this._name}" ${phase} failed: ${detail}`,
    );
  }

  /**
   * Returns the current instance or throws a clear "not configured" error.
   *
   * @returns The built `Telegraf`.
   * @throws {TelegramConfigError} If no token is configured yet.
   */
  private requireBot(): Telegraf {
    if (this._bot === null)
      throw new TelegramConfigError(
        `Runtime bot "${this._name}" is not configured; call configure({ token }) first.`,
      );
    return this._bot;
  }

  /**
   * Chains `op` after any in-flight mutating operation so rebuilds and stops are
   * applied one at a time (atomic reconfiguration).
   *
   * @typeParam T - The resolved result type of `op`.
   * @param op - The operation to serialize.
   * @returns The result of `op`.
   * @throws Whatever `op` throws (mutating ops are written not to throw).
   */
  private serialize<T>(op: () => Promise<T>): Promise<T> {
    const run = this._lock.then(op, op);
    // ── Keep the chain alive past either outcome without leaking a rejection. ──
    this._lock = run.then(
      () => undefined,
      () => undefined,
    );
    return run;
  }
}
