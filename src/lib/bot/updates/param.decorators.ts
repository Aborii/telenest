/**
 * @file src/lib/bot/updates/param.decorators.ts
 *
 * PURPOSE
 * -------
 * Parameter decorators for `@TelegramUpdate` handler methods. Each records, in
 * reflect-metadata, which value the argument resolver should inject at a given
 * parameter position when an update fires.
 *
 * USAGE
 * -----
 * ```ts
 * @On('text')
 * onText(@MessageText() text: string | undefined, @Sender() from: User | undefined) { ... }
 * ```
 *
 * KEY EXPORTS
 * -----------
 * - Ctx: inject the raw Telegraf `Context`.
 * - MessageText: inject the incoming message text (or `undefined`).
 * - Sender: inject the triggering `User` (`ctx.from`, or `undefined`).
 * - CallbackData: inject a callback query's `data` string (or `undefined`).
 */

import 'reflect-metadata';
import {
  PARAM_KINDS,
  UPDATE_PARAMS_METADATA,
  type ParamKind,
  type ParamMetadata,
} from './telegram-update.types';

/**
 * Records a parameter-injection descriptor on the handler method, preserving any
 * descriptors added by sibling parameter decorators.
 *
 * @param target - The prototype carrying the method (decorator `target`).
 * @param propertyKey - The decorated method's name (`undefined` for constructor
 *   parameters, which are not supported and ignored).
 * @param index - Zero-based parameter position.
 * @param kind - What the resolver should inject at that position.
 * @returns Nothing.
 * @throws Never.
 */
function appendParam(
  target: object,
  propertyKey: string | symbol | undefined,
  index: number,
  kind: ParamKind,
): void {
  if (propertyKey === undefined) return;

  const method = (target as Record<string | symbol, unknown>)[propertyKey] as
    | object
    | undefined;
  if (!method) return;

  const existing =
    (Reflect.getMetadata(UPDATE_PARAMS_METADATA, method) as
      | ParamMetadata[]
      | undefined) ?? [];
  Reflect.defineMetadata(
    UPDATE_PARAMS_METADATA,
    [...existing, { index, kind }],
    method,
  );
}

/**
 * Injects the raw Telegraf `Context` for the current update.
 *
 * @returns A parameter decorator.
 * @throws Never.
 */
export function Ctx(): ParameterDecorator {
  return (target, propertyKey, index) =>
    appendParam(target, propertyKey, index, PARAM_KINDS.CONTEXT);
}

/**
 * Injects the incoming message text (`ctx.text`), or `undefined` when the update
 * carries no text.
 *
 * @returns A parameter decorator.
 * @throws Never.
 */
export function MessageText(): ParameterDecorator {
  return (target, propertyKey, index) =>
    appendParam(target, propertyKey, index, PARAM_KINDS.MESSAGE_TEXT);
}

/**
 * Injects the `User` who triggered the update (`ctx.from`), or `undefined`.
 *
 * @returns A parameter decorator.
 * @throws Never.
 */
export function Sender(): ParameterDecorator {
  return (target, propertyKey, index) =>
    appendParam(target, propertyKey, index, PARAM_KINDS.SENDER);
}

/**
 * Injects the `data` string of a callback query (button press), or `undefined`
 * when the update is not a data-bearing callback query.
 *
 * @returns A parameter decorator.
 * @throws Never.
 */
export function CallbackData(): ParameterDecorator {
  return (target, propertyKey, index) =>
    appendParam(target, propertyKey, index, PARAM_KINDS.CALLBACK_DATA);
}
