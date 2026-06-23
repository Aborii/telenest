/**
 * @file src/lib/bot/updates/telegram-update.decorator.ts
 *
 * PURPOSE
 * -------
 * The class and method decorators that make a NestJS provider a first-class Bot
 * API update handler. `@TelegramUpdate()` marks the class so the registrar scans
 * it; the method decorators (`@Start`, `@Help`, `@Command`, `@Hears`, `@Action`,
 * `@On`, `@Use`) record how each method binds onto the underlying `Telegraf`
 * instance. Multiple method decorators may be stacked on one method — each
 * appends a binding.
 *
 * USAGE
 * -----
 * ```ts
 * @TelegramUpdate()
 * export class GreeterUpdate {
 *   @Start() onStart(@Ctx() ctx: Context) { return ctx.reply('hi'); }
 *   @Command('ping') onPing(@Ctx() ctx: Context) { return ctx.reply('pong'); }
 * }
 *
 * // Scope a provider's handlers to a specific named bot (multi-bot apps):
 * @TelegramUpdate({ bot: 'support' })
 * export class SupportUpdate {
 *   @Command('ticket') onTicket(@Ctx() ctx: Context) { return ctx.reply('opened'); }
 * }
 * ```
 *
 * KEY EXPORTS
 * -----------
 * - TelegramUpdate: class decorator marking an update provider (optionally
 *   scoped to a named bot).
 * - TelegramUpdateOptions: options accepted by `@TelegramUpdate`.
 * - Start / Help / Command / Hears / Action / On / Use: method decorators.
 */

import 'reflect-metadata';

import { SetMetadata } from '@nestjs/common';
import type { Telegraf } from 'telegraf';

import { DEFAULT_BOT_NAME } from '../telegram-bot.constants';
import {
  BOT_UPDATE_KINDS,
  IS_TELEGRAM_UPDATE_METADATA,
  TELEGRAM_UPDATE_BOT_METADATA,
  UPDATE_BINDINGS_METADATA,
  type UpdateBinding,
} from './telegram-update.types';

/**
 * Appends an {@link UpdateBinding} to a handler method's metadata, preserving any
 * bindings added by other stacked decorators on the same method.
 *
 * @param target - The prototype carrying the method (decorator `target`).
 * @param propertyKey - The decorated method's name.
 * @param binding - The binding descriptor to record.
 * @returns Nothing.
 * @throws Never.
 */
function appendBinding(
  target: object,
  propertyKey: string | symbol,
  binding: UpdateBinding,
): void {
  // ── Metadata is attached to the method function itself, which is the same
  //    reference the registrar later reads off the resolved instance. ────────
  const method = (target as Record<string | symbol, unknown>)[propertyKey] as
    | object
    | undefined;
  if (!method) return;

  const existing =
    (Reflect.getMetadata(UPDATE_BINDINGS_METADATA, method) as
      | UpdateBinding[]
      | undefined) ?? [];
  Reflect.defineMetadata(
    UPDATE_BINDINGS_METADATA,
    [...existing, binding],
    method,
  );
}

/** Options for the {@link TelegramUpdate} class decorator. */
export interface TelegramUpdateOptions {
  /**
   * Name of the registered bot whose updates this provider's handlers bind to.
   * Must match the `name` passed to the corresponding
   * `TelegramBotModule.forRoot({ name })` / `forRootAsync({ name })`. Omit (or
   * pass the default bot name) to bind to the default bot. In a multi-bot app
   * each handler is bound onto exactly one bot — the one named here.
   */
  readonly bot?: string;
}

/**
 * Marks a class as a Telegram update provider. Only methods on classes wearing
 * this decorator are scanned and bound by the registrar.
 *
 * Records two pieces of class metadata: the scan marker, and the **target bot
 * name** (`options.bot`, defaulting to the default bot). The per-bot registrar
 * binds only the providers whose target bot matches the bot it serves, so in a
 * multi-bot application a provider's handlers are never bound onto another bot.
 *
 * @param options - Optional settings; `bot` scopes the provider to a named bot.
 * @returns A class decorator attaching the scan marker and target-bot name.
 * @throws Never.
 *
 * @example
 * ```ts
 * @TelegramUpdate()                 // default bot
 * export class MyUpdate { ... }
 *
 * @TelegramUpdate({ bot: 'notify' }) // the bot registered as `name: 'notify'`
 * export class NotifyUpdate { ... }
 * ```
 */
export function TelegramUpdate(
  options?: TelegramUpdateOptions,
): ClassDecorator {
  const botName = options?.bot ?? DEFAULT_BOT_NAME;
  return (target) => {
    // ── Two markers: "scan me" + which bot these handlers belong to. ──────────
    SetMetadata(IS_TELEGRAM_UPDATE_METADATA, true)(target);
    SetMetadata(TELEGRAM_UPDATE_BOT_METADATA, botName)(target);
  };
}

/**
 * Handles the `/start` command (binds to `Telegraf.start`).
 *
 * @returns A method decorator recording the binding.
 * @throws Never.
 */
export function Start(): MethodDecorator {
  return (target, propertyKey) =>
    appendBinding(target, propertyKey, { kind: BOT_UPDATE_KINDS.START });
}

/**
 * Handles the `/help` command (binds to `Telegraf.help`).
 *
 * @returns A method decorator recording the binding.
 * @throws Never.
 */
export function Help(): MethodDecorator {
  return (target, propertyKey) =>
    appendBinding(target, propertyKey, { kind: BOT_UPDATE_KINDS.HELP });
}

/**
 * Handles one or more named slash commands (binds to `Telegraf.command`).
 *
 * @param trigger - Command name(s), e.g. `'ping'` or `['ping', 'pong']`.
 * @returns A method decorator recording the binding.
 * @throws Never.
 */
export function Command(
  trigger: Parameters<Telegraf['command']>[0],
): MethodDecorator {
  return (target, propertyKey) =>
    appendBinding(target, propertyKey, {
      kind: BOT_UPDATE_KINDS.COMMAND,
      trigger,
    });
}

/**
 * Handles text matching a trigger (binds to `Telegraf.hears`).
 *
 * @param trigger - String, `RegExp`, predicate, or an array thereof.
 * @returns A method decorator recording the binding.
 * @throws Never.
 */
export function Hears(
  trigger: Parameters<Telegraf['hears']>[0],
): MethodDecorator {
  return (target, propertyKey) =>
    appendBinding(target, propertyKey, {
      kind: BOT_UPDATE_KINDS.HEARS,
      trigger,
    });
}

/**
 * Handles inline-keyboard callback queries matching a trigger (binds to
 * `Telegraf.action`).
 *
 * @param trigger - Callback-data string, `RegExp`, predicate, or array thereof.
 * @returns A method decorator recording the binding.
 * @throws Never.
 */
export function Action(
  trigger: Parameters<Telegraf['action']>[0],
): MethodDecorator {
  return (target, propertyKey) =>
    appendBinding(target, propertyKey, {
      kind: BOT_UPDATE_KINDS.ACTION,
      trigger,
    });
}

/**
 * Handles a raw update/message type (binds to `Telegraf.on`), e.g. `@On('text')`.
 *
 * @param trigger - Update-type filter(s) forwarded to `Telegraf.on`.
 * @returns A method decorator recording the binding.
 * @throws Never.
 */
export function On(trigger: Parameters<Telegraf['on']>[0]): MethodDecorator {
  return (target, propertyKey) =>
    appendBinding(target, propertyKey, {
      kind: BOT_UPDATE_KINDS.ON,
      trigger,
    });
}

/**
 * Registers the method as global middleware run for every update (binds to
 * `Telegraf.use`). Because middleware runs in registration order, ordering
 * across providers follows discovery order.
 *
 * @returns A method decorator recording the binding.
 * @throws Never.
 */
export function Use(): MethodDecorator {
  return (target, propertyKey) =>
    appendBinding(target, propertyKey, { kind: BOT_UPDATE_KINDS.USE });
}
