/**
 * @file src/lib/bot/inline-query-result.builder.spec.ts
 *
 * PURPOSE
 * -------
 * Unit tests for the fluent {@link InlineQueryResultBuilder}: auto-id assignment,
 * explicit-id passthrough + validation, the `article` text shorthand, every
 * typed result method (fresh + cached variants), the generic `add` escape hatch,
 * the static `text` content helper, and build immutability.
 */

import { InlineQueryResultBuilder } from './inline-query-result.builder';

describe('InlineQueryResultBuilder', () => {
  it('auto-assigns sequential ids when none are supplied', () => {
    const results = new InlineQueryResultBuilder()
      .article({ title: 'A', text: 'a' })
      .article({ title: 'B', text: 'b' })
      .build();

    expect(results.map((r) => r.id)).toEqual(['auto_0', 'auto_1']);
  });

  it('uses an explicit id verbatim and keeps the auto counter independent', () => {
    const results = new InlineQueryResultBuilder()
      .article({ id: 'pinned', title: 'A', text: 'a' })
      .article({ title: 'B', text: 'b' })
      .build();

    expect(results.map((r) => r.id)).toEqual(['pinned', 'auto_0']);
  });

  it('rejects an out-of-range explicit id', () => {
    const builder = new InlineQueryResultBuilder();
    expect(() => builder.article({ id: '', title: 'A', text: 'a' })).toThrow(
      RangeError,
    );
    expect(() =>
      builder.article({ id: 'x'.repeat(65), title: 'A', text: 'a' }),
    ).toThrow(/1-64 bytes/);
  });

  it('builds an article from the text shorthand', () => {
    const [result] = new InlineQueryResultBuilder()
      .article({ title: 'Echo', text: 'hello' })
      .build();

    expect(result).toMatchObject({
      type: 'article',
      title: 'Echo',
      input_message_content: { message_text: 'hello' },
    });
  });

  it('prefers an explicit input_message_content over the text shorthand', () => {
    const [result] = new InlineQueryResultBuilder()
      .article({
        title: 'Echo',
        text: 'ignored',
        input_message_content: { message_text: 'kept' },
      })
      .build();

    expect(result).toMatchObject({
      input_message_content: { message_text: 'kept' },
    });
  });

  it('throws when an article has neither content nor text', () => {
    expect(() =>
      new InlineQueryResultBuilder().article({ title: 'No body' }),
    ).toThrow(TypeError);
  });

  it('builds each fresh result type with its discriminant', () => {
    const results = new InlineQueryResultBuilder()
      .photo({ photo_url: 'p', thumbnail_url: 't' })
      .gif({ gif_url: 'g', thumbnail_url: 't' })
      .mpeg4Gif({ mpeg4_url: 'm', thumbnail_url: 't' })
      .video({
        video_url: 'v',
        mime_type: 'video/mp4',
        thumbnail_url: 't',
        title: 'V',
      })
      .audio({ audio_url: 'a', title: 'A' })
      .voice({ voice_url: 'vo', title: 'Vo' })
      .document({ document_url: 'd', mime_type: 'application/pdf', title: 'D' })
      .location({ latitude: 1, longitude: 2, title: 'L' })
      .venue({ latitude: 1, longitude: 2, title: 'Ven', address: 'Addr' })
      .contact({ phone_number: '+1', first_name: 'C' })
      .game({ game_short_name: 'chess' })
      .build();

    expect(results.map((r) => r.type)).toEqual([
      'photo',
      'gif',
      'mpeg4_gif',
      'video',
      'audio',
      'voice',
      'document',
      'location',
      'venue',
      'contact',
      'game',
    ]);
  });

  it('builds each cached result type with its discriminant and file id', () => {
    const results = new InlineQueryResultBuilder()
      .cachedPhoto({ photo_file_id: 'pf' })
      .cachedGif({ gif_file_id: 'gf' })
      .cachedMpeg4Gif({ mpeg4_file_id: 'mf' })
      .cachedSticker({ sticker_file_id: 'sf' })
      .cachedDocument({ document_file_id: 'df', title: 'D' })
      .cachedVideo({ video_file_id: 'vf', title: 'V' })
      .cachedVoice({ voice_file_id: 'vof', title: 'Vo' })
      .cachedAudio({ audio_file_id: 'af' })
      .build();

    expect(results.map((r) => r.type)).toEqual([
      'photo',
      'gif',
      'mpeg4_gif',
      'sticker',
      'document',
      'video',
      'voice',
      'audio',
    ]);
    // ── The cached photo carries its file id, not a url. ──────────────────────
    expect(results[0]).toMatchObject({ photo_file_id: 'pf' });
  });

  it('appends a fully-formed result verbatim via add()', () => {
    const results = new InlineQueryResultBuilder()
      .add({
        type: 'article',
        id: 'raw',
        title: 'Raw',
        input_message_content: { message_text: 'x' },
      })
      .build();

    expect(results).toEqual([
      {
        type: 'article',
        id: 'raw',
        title: 'Raw',
        input_message_content: { message_text: 'x' },
      },
    ]);
  });

  it('returns a fresh array snapshot on each build()', () => {
    const builder = new InlineQueryResultBuilder().article({
      title: 'A',
      text: 'a',
    });
    const first = builder.build();
    builder.article({ title: 'B', text: 'b' });
    const second = builder.build();

    expect(first).toHaveLength(1);
    expect(second).toHaveLength(2);
    expect(first).not.toBe(second);
  });

  describe('static text()', () => {
    it('builds a plain text message content', () => {
      expect(InlineQueryResultBuilder.text('hi')).toEqual({
        message_text: 'hi',
      });
    });

    it('merges extra fields like parse_mode', () => {
      expect(
        InlineQueryResultBuilder.text('*hi*', { parse_mode: 'MarkdownV2' }),
      ).toEqual({ message_text: '*hi*', parse_mode: 'MarkdownV2' });
    });
  });
});
