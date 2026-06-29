/**
 * @file src/lib/bot/runtime/telegram-bot-runtime.constants.spec.ts
 *
 * PURPOSE
 * -------
 * Unit tests for the runtime-bot DI token helpers: the default and named tokens
 * are stable and distinct, and `InjectBotRuntime` wires a provider to the right
 * manager token (resolving the actual manager in a Nest container).
 */

import { Injectable } from '@nestjs/common';
import { Test } from '@nestjs/testing';

import { asTelegraf, createMockTelegraf } from '../../testing/mock-telegraf';
import { TelegramBotModule } from '../telegram-bot.module';
import {
  getBotRuntimeOptionsToken,
  getBotRuntimeToken,
  InjectBotRuntime,
} from './telegram-bot-runtime.constants';
import { TelegramBotRuntime } from './telegram-bot-runtime.service';

describe('runtime token helpers', () => {
  it('derives stable, name-scoped tokens for the default and named bots', () => {
    expect(getBotRuntimeToken()).toBe('NESTJS_TELEGRAM_BOT_RUNTIME:default');
    expect(getBotRuntimeToken('admin')).toBe(
      'NESTJS_TELEGRAM_BOT_RUNTIME:admin',
    );
    expect(getBotRuntimeOptionsToken()).toBe(
      'NESTJS_TELEGRAM_BOT_RUNTIME_OPTIONS:default',
    );
    expect(getBotRuntimeOptionsToken('admin')).toBe(
      'NESTJS_TELEGRAM_BOT_RUNTIME_OPTIONS:admin',
    );
    // ── Manager and options tokens never collide. ──────────────────────────────
    expect(getBotRuntimeToken('admin')).not.toBe(
      getBotRuntimeOptionsToken('admin'),
    );
  });

  it('@InjectBotRuntime injects the manager into a consumer provider', async () => {
    @Injectable()
    class Consumer {
      public constructor(
        @InjectBotRuntime() public readonly bot: TelegramBotRuntime,
      ) {}
    }

    const moduleRef = await Test.createTestingModule({
      imports: [
        TelegramBotModule.forRootRuntime({
          botFactory: () => asTelegraf(createMockTelegraf()),
        }),
      ],
      providers: [Consumer],
    }).compile();
    try {
      const consumer = moduleRef.get(Consumer);
      expect(consumer.bot).toBeInstanceOf(TelegramBotRuntime);
      // ── Same instance the manager token resolves to. ─────────────────────────
      expect(consumer.bot).toBe(
        moduleRef.get<TelegramBotRuntime>(getBotRuntimeToken(), {
          strict: false,
        }),
      );
    } finally {
      await moduleRef.close();
    }
  });
});
