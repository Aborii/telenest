/**
 * @file src/lib/bot/keyboard.builder.spec.ts
 *
 * PURPOSE
 * -------
 * Unit tests for the inline/reply keyboard builders and the one-shot markup
 * helpers. These are pure functions, so the tests assert exact output shapes.
 */

import {
  ForceReply,
  InlineKeyboardBuilder,
  ReplyKeyboardBuilder,
  forceReply,
  removeKeyboard,
} from './keyboard.builder';

describe('InlineKeyboardBuilder', () => {
  it('builds rows of url / callback / web_app buttons', () => {
    const markup = new InlineKeyboardBuilder()
      .url('Docs', 'https://example.com')
      .callback('Ping', 'ping')
      .row()
      .webApp('App', 'https://example.com/app')
      .build();

    expect(markup).toEqual({
      inline_keyboard: [
        [
          { text: 'Docs', url: 'https://example.com' },
          { text: 'Ping', callback_data: 'ping' },
        ],
        [{ text: 'App', web_app: { url: 'https://example.com/app' } }],
      ],
    });
  });

  it('ignores empty rows', () => {
    const markup = new InlineKeyboardBuilder()
      .row()
      .callback('Only', 'only')
      .row()
      .row()
      .build();

    expect(markup.inline_keyboard).toHaveLength(1);
  });

  it('rejects callback_data longer than 64 bytes', () => {
    const builder = new InlineKeyboardBuilder();
    expect(() => builder.callback('x', 'a'.repeat(65))).toThrow(RangeError);
  });

  it('accepts callback_data of exactly 64 bytes', () => {
    const builder = new InlineKeyboardBuilder();
    expect(() => builder.callback('x', 'a'.repeat(64))).not.toThrow();
  });

  it('returns detached snapshots (mutating the builder never changes prior output)', () => {
    const builder = new InlineKeyboardBuilder().callback('A', 'a');
    const first = builder.build();

    // ── Each build() flushes the open row, so adding then rebuilding produces
    //    a second row — and the earlier snapshot must remain untouched. ───────
    builder.callback('B', 'b');
    const second = builder.build();

    expect(first.inline_keyboard).toEqual([[{ text: 'A', callback_data: 'a' }]]);
    expect(second.inline_keyboard).toEqual([
      [{ text: 'A', callback_data: 'a' }],
      [{ text: 'B', callback_data: 'b' }],
    ]);
  });
});

describe('ReplyKeyboardBuilder', () => {
  it('builds text / contact / location buttons with flags', () => {
    const markup = new ReplyKeyboardBuilder()
      .text('Hello')
      .row()
      .requestContact('Share contact')
      .requestLocation('Share location')
      .resize()
      .oneTime()
      .placeholder('Pick one')
      .build();

    expect(markup).toEqual({
      keyboard: [
        [{ text: 'Hello' }],
        [
          { text: 'Share contact', request_contact: true },
          { text: 'Share location', request_location: true },
        ],
      ],
      resize_keyboard: true,
      one_time_keyboard: true,
      input_field_placeholder: 'Pick one',
    });
  });

  it('omits flags that were never set', () => {
    const markup = new ReplyKeyboardBuilder().text('Hi').build();
    expect(markup).toEqual({ keyboard: [[{ text: 'Hi' }]] });
  });

  it('supports selective targeting', () => {
    const markup = new ReplyKeyboardBuilder().text('Hi').selective().build();
    expect(markup.selective).toBe(true);
  });
});

describe('removeKeyboard', () => {
  it('returns a bare remove flag by default', () => {
    expect(removeKeyboard()).toEqual({ remove_keyboard: true });
  });

  it('includes selective when requested', () => {
    expect(removeKeyboard(true)).toEqual({
      remove_keyboard: true,
      selective: true,
    });
  });
});

describe('forceReply', () => {
  it('returns a bare force flag by default', () => {
    expect(forceReply()).toEqual({ force_reply: true });
  });

  it('includes placeholder and selective when provided', () => {
    const result: ForceReply = forceReply({
      inputFieldPlaceholder: 'Type here',
      selective: true,
    });
    expect(result).toEqual({
      force_reply: true,
      input_field_placeholder: 'Type here',
      selective: true,
    });
  });
});
