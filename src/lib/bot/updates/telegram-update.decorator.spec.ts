/**
 * @file src/lib/bot/updates/telegram-update.decorator.spec.ts
 *
 * PURPOSE
 * -------
 * Verifies the class/method decorators attach the expected reflect-metadata: the
 * class scan marker, one binding per method decorator, correct kinds/triggers,
 * and accumulation when decorators are stacked on a single method.
 */

import 'reflect-metadata';

import { DEFAULT_BOT_NAME } from '../telegram-bot.constants';
import {
  Action,
  Command,
  Hears,
  Help,
  On,
  Start,
  TelegramUpdate,
  Use,
} from './telegram-update.decorator';
import {
  BOT_UPDATE_KINDS,
  IS_TELEGRAM_UPDATE_METADATA,
  TELEGRAM_UPDATE_BOT_METADATA,
  UPDATE_BINDINGS_METADATA,
  type UpdateBinding,
} from './telegram-update.types';

/** Reads the binding array a method decorator stored on a prototype method. */
function bindingsOf(prototype: object, method: string): UpdateBinding[] {
  const fn = (prototype as Record<string, unknown>)[method] as object;
  return (
    (Reflect.getMetadata(UPDATE_BINDINGS_METADATA, fn) as UpdateBinding[]) ?? []
  );
}

describe('@TelegramUpdate class decorator', () => {
  it('marks the class and targets the default bot when no options are given', () => {
    @TelegramUpdate()
    class Marked {}

    expect(Reflect.getMetadata(IS_TELEGRAM_UPDATE_METADATA, Marked)).toBe(true);
    expect(Reflect.getMetadata(TELEGRAM_UPDATE_BOT_METADATA, Marked)).toBe(
      DEFAULT_BOT_NAME,
    );
  });

  it('records the target bot name from { bot } for a named bot', () => {
    @TelegramUpdate({ bot: 'notify' })
    class NotifyMarked {}

    expect(Reflect.getMetadata(IS_TELEGRAM_UPDATE_METADATA, NotifyMarked)).toBe(
      true,
    );
    expect(
      Reflect.getMetadata(TELEGRAM_UPDATE_BOT_METADATA, NotifyMarked),
    ).toBe('notify');
  });

  it('leaves undecorated classes unmarked', () => {
    class Plain {}
    expect(
      Reflect.getMetadata(IS_TELEGRAM_UPDATE_METADATA, Plain),
    ).toBeUndefined();
    expect(
      Reflect.getMetadata(TELEGRAM_UPDATE_BOT_METADATA, Plain),
    ).toBeUndefined();
  });
});

describe('method decorators', () => {
  class Handlers {
    @Start() onStart(): void {}
    @Help() onHelp(): void {}
    @Command('ping') onPing(): void {}
    @Hears(/hi/) onHi(): void {}
    @Action('go') onGo(): void {}
    @On('text') onText(): void {}
    @Use() onUse(): void {}
  }

  const proto = Handlers.prototype;

  it('records start/help/use with no trigger', () => {
    expect(bindingsOf(proto, 'onStart')).toEqual([
      { kind: BOT_UPDATE_KINDS.START },
    ]);
    expect(bindingsOf(proto, 'onHelp')).toEqual([
      { kind: BOT_UPDATE_KINDS.HELP },
    ]);
    expect(bindingsOf(proto, 'onUse')).toEqual([
      { kind: BOT_UPDATE_KINDS.USE },
    ]);
  });

  it('records command/hears/action/on with their trigger', () => {
    expect(bindingsOf(proto, 'onPing')).toEqual([
      { kind: BOT_UPDATE_KINDS.COMMAND, trigger: 'ping' },
    ]);
    expect(bindingsOf(proto, 'onHi')).toEqual([
      { kind: BOT_UPDATE_KINDS.HEARS, trigger: /hi/ },
    ]);
    expect(bindingsOf(proto, 'onGo')).toEqual([
      { kind: BOT_UPDATE_KINDS.ACTION, trigger: 'go' },
    ]);
    expect(bindingsOf(proto, 'onText')).toEqual([
      { kind: BOT_UPDATE_KINDS.ON, trigger: 'text' },
    ]);
  });

  it('accumulates multiple stacked decorators on one method', () => {
    class Stacked {
      @Command('a') @Command('b') both(): void {}
    }

    // ── Decorators apply bottom-up, so 'b' is appended before 'a'. ───────────
    expect(bindingsOf(Stacked.prototype, 'both')).toEqual([
      { kind: BOT_UPDATE_KINDS.COMMAND, trigger: 'b' },
      { kind: BOT_UPDATE_KINDS.COMMAND, trigger: 'a' },
    ]);
  });
});
