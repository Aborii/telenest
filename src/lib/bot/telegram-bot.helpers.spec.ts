/**
 * @file src/lib/bot/telegram-bot.helpers.spec.ts
 *
 * PURPOSE
 * -------
 * Unit tests for the convenience helpers added to {@link TelegramBotService}:
 * `downloadFile` / `downloadFileStream` (mocked `getFileLink` + global `fetch`),
 * `sendLongMessage` (auto-splitting), the `withRetry` / codec instance wrappers,
 * and the `retry_after` capture in {@link TelegramBotApiError}. No network is
 * touched — `fetch` is stubbed.
 */

import type { Telegraf } from 'telegraf';

import { TelegramBotApiError } from '../common';
import { TelegramBotService } from './telegram-bot.service';

/** Mock `telegram` surface the helpers touch. */
interface MockTelegram {
  getFileLink: jest.Mock;
  sendMessage: jest.Mock;
}

/** Builds a service over a mock bot exposing the given `telegram` methods. */
function createService(): {
  service: TelegramBotService;
  telegram: MockTelegram;
} {
  const telegram: MockTelegram = {
    getFileLink: jest.fn(),
    sendMessage: jest.fn(),
  };
  const bot = {
    telegram,
    launch: jest.fn(),
    stop: jest.fn(),
  } as unknown as Telegraf;
  const service = new TelegramBotService(bot, { token: 'x', launch: false });
  return { service, telegram };
}

/** Original global `fetch`, restored after each test. */
const originalFetch = global.fetch;

/** Stubs the global `fetch` to resolve with the given (partial) Response. */
function stubFetch(response: Partial<Response>): jest.Mock {
  const fn = jest.fn().mockResolvedValue(response as Response);
  global.fetch = fn as unknown as typeof fetch;
  return fn;
}

afterEach(() => {
  global.fetch = originalFetch;
});

describe('TelegramBotService convenience helpers', () => {
  describe('downloadFile', () => {
    it('resolves the link, fetches the bytes, and returns a Buffer', async () => {
      const { service, telegram } = createService();
      const url = new URL('https://cdn.telegram/file.bin');
      telegram.getFileLink.mockResolvedValue(url);
      const payload = Buffer.from('hello world');
      const fetchFn = stubFetch({
        ok: true,
        status: 200,
        statusText: 'OK',
        arrayBuffer: async () =>
          payload.buffer.slice(
            payload.byteOffset,
            payload.byteOffset + payload.byteLength,
          ),
      });

      const result = await service.downloadFile('file-id');

      expect(telegram.getFileLink).toHaveBeenCalledWith('file-id');
      expect(fetchFn).toHaveBeenCalledWith(url);
      expect(Buffer.isBuffer(result)).toBe(true);
      expect(result.toString('utf8')).toBe('hello world');
    });

    it('wraps a non-2xx response in TelegramBotApiError', async () => {
      const { service, telegram } = createService();
      telegram.getFileLink.mockResolvedValue(new URL('https://cdn/x'));
      stubFetch({ ok: false, status: 404, statusText: 'Not Found' });

      const error = await service.downloadFile('id').catch((e: unknown) => e);
      expect(error).toBeInstanceOf(TelegramBotApiError);
      expect(error).toMatchObject({ method: 'downloadFile' });
      expect((error as TelegramBotApiError).message).toContain('404');
    });

    it('wraps a getFileLink failure in TelegramBotApiError', async () => {
      const { service, telegram } = createService();
      telegram.getFileLink.mockRejectedValue({ code: 400, message: 'bad' });

      await expect(service.downloadFile('id')).rejects.toBeInstanceOf(
        TelegramBotApiError,
      );
    });
  });

  describe('downloadFileStream', () => {
    it('returns the response body stream', async () => {
      const { service, telegram } = createService();
      telegram.getFileLink.mockResolvedValue(new URL('https://cdn/x'));
      const body = {
        getReader: jest.fn(),
      } as unknown as NonNullable<Response['body']>;
      stubFetch({ ok: true, status: 200, statusText: 'OK', body });

      await expect(service.downloadFileStream('id')).resolves.toBe(body);
    });

    it('throws (wrapped) when the body is empty', async () => {
      const { service, telegram } = createService();
      telegram.getFileLink.mockResolvedValue(new URL('https://cdn/x'));
      stubFetch({ ok: true, status: 200, statusText: 'OK', body: null });

      const error = await service
        .downloadFileStream('id')
        .catch((e: unknown) => e);
      expect(error).toBeInstanceOf(TelegramBotApiError);
      expect((error as TelegramBotApiError).message).toContain('empty');
    });

    it('wraps a non-2xx response', async () => {
      const { service, telegram } = createService();
      telegram.getFileLink.mockResolvedValue(new URL('https://cdn/x'));
      stubFetch({ ok: false, status: 500, statusText: 'Server Error' });

      await expect(service.downloadFileStream('id')).rejects.toBeInstanceOf(
        TelegramBotApiError,
      );
    });
  });

  describe('sendLongMessage', () => {
    it('sends a single message when the text fits', async () => {
      const { service, telegram } = createService();
      telegram.sendMessage.mockImplementation((_chat, text: string) =>
        Promise.resolve({ message_id: 1, text }),
      );

      const sent = await service.sendLongMessage(42, 'short');

      expect(telegram.sendMessage).toHaveBeenCalledTimes(1);
      expect(telegram.sendMessage).toHaveBeenCalledWith(42, 'short', undefined);
      expect(sent).toHaveLength(1);
    });

    it('splits over-length text into ordered chunks and forwards extra', async () => {
      const { service, telegram } = createService();
      telegram.sendMessage.mockImplementation((_chat, text: string) =>
        Promise.resolve({ text }),
      );
      const extra = { parse_mode: 'HTML' as const };
      const text = `${'a'.repeat(4096)}\n${'b'.repeat(10)}`;

      const sent = await service.sendLongMessage(42, text, extra);

      expect(telegram.sendMessage).toHaveBeenCalledTimes(2);
      // Order preserved: first the 4096-char chunk, then the short tail.
      expect(telegram.sendMessage).toHaveBeenNthCalledWith(
        1,
        42,
        'a'.repeat(4096),
        extra,
      );
      expect(telegram.sendMessage).toHaveBeenNthCalledWith(
        2,
        42,
        'b'.repeat(10),
        extra,
      );
      expect(sent).toHaveLength(2);
    });

    it('applies reply_markup to the last chunk only when splitting', async () => {
      const { service, telegram } = createService();
      telegram.sendMessage.mockImplementation((_chat, text: string) =>
        Promise.resolve({ text }),
      );
      const reply_markup = {
        inline_keyboard: [[{ text: 'ok', callback_data: 'ok' }]],
      };
      const extra = { parse_mode: 'HTML' as const, reply_markup };
      const text = `${'a'.repeat(4096)}\n${'b'.repeat(10)}`;

      await service.sendLongMessage(42, text, extra);

      // ── First chunk: parse_mode kept, keyboard dropped. ─────────────────────
      expect(telegram.sendMessage).toHaveBeenNthCalledWith(
        1,
        42,
        'a'.repeat(4096),
        {
          parse_mode: 'HTML',
        },
      );
      // ── Last chunk: keyboard appears once, at the end. ──────────────────────
      expect(telegram.sendMessage).toHaveBeenNthCalledWith(
        2,
        42,
        'b'.repeat(10),
        {
          parse_mode: 'HTML',
          reply_markup,
        },
      );
    });

    it('applies reply_parameters to the first chunk only when splitting', async () => {
      const { service, telegram } = createService();
      telegram.sendMessage.mockImplementation((_chat, text: string) =>
        Promise.resolve({ text }),
      );
      const extra = { reply_parameters: { message_id: 7 } };
      const text = `${'a'.repeat(4096)}\n${'b'.repeat(10)}`;

      await service.sendLongMessage(42, text, extra);

      // ── Reply target on the first chunk; dropped on the rest. ───────────────
      expect(telegram.sendMessage).toHaveBeenNthCalledWith(
        1,
        42,
        'a'.repeat(4096),
        {
          reply_parameters: { message_id: 7 },
        },
      );
      expect(telegram.sendMessage).toHaveBeenNthCalledWith(
        2,
        42,
        'b'.repeat(10),
        {},
      );
    });

    it('sends nothing for empty text', async () => {
      const { service, telegram } = createService();
      const sent = await service.sendLongMessage(42, '');
      expect(telegram.sendMessage).not.toHaveBeenCalled();
      expect(sent).toEqual([]);
    });

    it('propagates a wrapped Bot API error from a chunk send', async () => {
      const { service, telegram } = createService();
      telegram.sendMessage.mockRejectedValue({ code: 403, message: 'blocked' });
      await expect(service.sendLongMessage(42, 'hi')).rejects.toBeInstanceOf(
        TelegramBotApiError,
      );
    });
  });

  describe('withRetry (instance wrapper)', () => {
    it('delegates to the retry helper and returns the result', async () => {
      const { service } = createService();
      const fn = jest
        .fn()
        .mockRejectedValueOnce({ retry_after: 0 })
        .mockResolvedValue('ok');

      await expect(service.withRetry(fn, { maxDelayMs: 0 })).resolves.toBe(
        'ok',
      );
      expect(fn).toHaveBeenCalledTimes(2);
    });
  });

  describe('callback-data codec (instance wrappers)', () => {
    it('round-trips through the instance methods', () => {
      const { service } = createService();
      const encoded = service.encodeCallbackData({ a: 'x', n: 1 });
      expect(service.decodeCallbackData(encoded)).toEqual({ a: 'x', n: 1 });
    });

    it('rejects an oversized payload', () => {
      const { service } = createService();
      expect(() => service.encodeCallbackData({ v: 'x'.repeat(100) })).toThrow(
        RangeError,
      );
    });
  });

  describe('retry_after capture', () => {
    it('captures retry_after from a 429 into the wrapped error', async () => {
      const { service, telegram } = createService();
      telegram.sendMessage.mockRejectedValue({
        response: { error_code: 429, parameters: { retry_after: 4 } },
        message: 'Too Many Requests',
      });

      const error = await service
        .sendLongMessage(1, 'hi')
        .catch((e: unknown) => e);
      expect(error).toBeInstanceOf(TelegramBotApiError);
      expect(error).toMatchObject({
        statusCode: 429,
        retryAfterSeconds: 4,
        method: 'sendMessage',
      });
    });
  });
});
