# Bot Inline Mode

First-class support for Telegram **inline mode** — a bot invoked via
`@botname query` from *any* chat, returning a list of results the user can pick
and send. `telenest` gives inline mode the same decorator-driven treatment
as the rest of the Bot API: typed method decorators (`@InlineQuery`,
`@ChosenInlineResult`), parameter decorators for the query text/offset, a fluent
`InlineQueryResultBuilder`, and an `answerInlineQuery` helper on
`TelegramBotService` — all on the **free** Bot API surface.

> **Prerequisite — enable inline mode in @BotFather.** Inline mode is off by
> default. Run `/setinline` (and set a placeholder) to start receiving
> `inline_query` updates; run `/setinlinefeedback` to additionally receive
> `chosen_inline_result` updates. Without these, the handlers below simply never
> fire.

This page builds on [BOT-UPDATE-DECORATORS.md](./BOT-UPDATE-DECORATORS.md); read
that first for the registrar/dispatch mechanics the inline decorators share.

---

## Table of contents

- [Architecture overview](#architecture-overview)
- [File structure](#file-structure)
- [Quick start](#quick-start)
- [Method decorators](#method-decorators)
- [Parameter decorators](#parameter-decorators)
- [The result builder](#the-result-builder)
- [Answering a query](#answering-a-query)
- [Pagination](#pagination)
- [Multiple bots](#multiple-bots)
- [Environment variables](#environment-variables)
- [Security notes](#security-notes)
- [How to extend](#how-to-extend)

---

## Architecture overview

Inline mode reuses the existing update pipeline end-to-end — no separate runtime:

1. **Decorators** record intent as reflect-metadata, exactly like `@Command` /
   `@On`. `@InlineQuery(pattern?)` appends an `INLINE_QUERY` binding;
   `@ChosenInlineResult()` appends a `CHOSEN_INLINE_RESULT` binding. The
   parameter decorators `@InlineQueryText` / `@InlineQueryOffset` append
   `ParamMetadata`.
2. **The registrar** binds each at bootstrap: a pattern routes through
   `bot.inlineQuery(pattern, …)`; a bare `@InlineQuery()` falls back to
   `bot.on('inline_query', …)` so it matches every query; `@ChosenInlineResult()`
   binds `bot.on('chosen_inline_result', …)`.
3. **The argument resolver** injects `ctx.inlineQuery?.query` /
   `ctx.inlineQuery?.offset` for the inline parameter decorators (both
   `undefined` on non-inline updates).
4. **You answer** with `ctx.answerInlineQuery(results, extra?)` or
   `TelegramBotService.answerInlineQuery(...)`, building `results` with the
   `InlineQueryResultBuilder`.

```text
user types @bot query ──► Telegraf 'inline_query' update
   └─ @InlineQuery(pattern?) handler (guards/interceptors/filters apply as usual)
        ├─ @InlineQueryText() / @InlineQueryOffset() injected from ctx.inlineQuery
        └─ ctx.answerInlineQuery( new InlineQueryResultBuilder()…build() )
user picks a result ──► Telegraf 'chosen_inline_result' update (needs feedback on)
   └─ @ChosenInlineResult() handler
```

All the enhancer machinery (`@UseTelegramGuards` / `Interceptors` / `Filters`)
works on inline handlers identically — see
[BOT-GUARDS-FILTERS-INTERCEPTORS.md](./BOT-GUARDS-FILTERS-INTERCEPTORS.md).

## File structure

```text
src/lib/bot/
  inline-query-result.builder.ts     # InlineQueryResultBuilder + derived result types
  telegram-bot.service.ts            # answerInlineQuery(...) facade method
  updates/
    telegram-update.types.ts         # INLINE_QUERY / CHOSEN_INLINE_RESULT kinds,
                                      #   INLINE_QUERY_TEXT / _OFFSET param kinds
    telegram-update.decorator.ts     # @InlineQuery / @ChosenInlineResult
    param.decorators.ts              # @InlineQueryText / @InlineQueryOffset
    argument-resolver.ts             # injects ctx.inlineQuery.query / .offset
    telegram-bot-updates.registrar.ts# binds inlineQuery / on('chosen_inline_result')
```

## Quick start

```ts
import { Injectable, Module } from '@nestjs/common';
import type { Context } from 'telegraf';
import {
  ChosenInlineResult,
  Ctx,
  InlineQuery,
  InlineQueryResultBuilder,
  InlineQueryText,
  TelegramBotModule,
  TelegramUpdate,
} from 'telenest';

@TelegramUpdate()
@Injectable()
export class InlineSearchUpdate {
  // Matches every inline query (no pattern).
  @InlineQuery()
  async onQuery(
    @Ctx() ctx: Context,
    @InlineQueryText() text: string | undefined,
  ): Promise<void> {
    const results = new InlineQueryResultBuilder()
      .article({ title: 'Echo', text: text || 'You typed nothing.' })
      .build();
    await ctx.answerInlineQuery(results, { cache_time: 0 });
  }

  // Only delivered once /setinlinefeedback is enabled.
  @ChosenInlineResult()
  onChosen(@Ctx() ctx: Context): void {
    console.log('chose', ctx.chosenInlineResult?.result_id);
  }
}

@Module({
  imports: [TelegramBotModule.forRoot({ token: process.env.BOT_TOKEN! })],
  providers: [InlineSearchUpdate],
})
export class AppModule {}
```

A full, type-checked example lives at
[`examples/inline-mode.example.ts`](../examples/inline-mode.example.ts).

## Method decorators

| Decorator | Binds to | Trigger |
| --- | --- | --- |
| `@InlineQuery(pattern?)` | `bot.inlineQuery(pattern, …)`, or `bot.on('inline_query', …)` when `pattern` is omitted | optional string / `RegExp` / array thereof |
| `@ChosenInlineResult()` | `bot.on('chosen_inline_result', …)` | — |

- **`pattern`** is matched against the query *text*. With a pattern, Telegraf
  exposes the captures via `ctx.match` (e.g. a `RegExp` group). Declare specific
  patterned handlers **before** a catch-all bare `@InlineQuery()`.
- Both are **terminal** handlers (they don't call `next`).
- Stacking is supported — e.g. `@InlineQuery(/^a/) @InlineQuery(/^b/)` on one
  method appends two bindings.

## Parameter decorators

| Decorator | Injects | Type | Absent → |
| --- | --- | --- | --- |
| `@InlineQueryText()` | `ctx.inlineQuery.query` | `string \| undefined` | `undefined` |
| `@InlineQueryOffset()` | `ctx.inlineQuery.offset` | `string \| undefined` | `undefined` |

You can always take `@Ctx()` instead and read `ctx.inlineQuery` /
`ctx.chosenInlineResult` directly. The inline parameter decorators are pure
convenience for the two most-used fields. On a non-inline update both inject
`undefined` (they never throw).

## The result builder

`InlineQueryResultBuilder` is a fluent, fully-typed builder for the `results`
array. Every result type and option shape is **derived from Telegraf's own
`answerInlineQuery` signature**, so it tracks the installed Telegraf version and
never drifts. Each `add*`-style call appends one result and returns `this`;
`build()` returns an immutable snapshot.

```ts
const results = new InlineQueryResultBuilder()
  .article({ title: 'Docs', url: 'https://core.telegram.org/bots/inline',
             input_message_content: InlineQueryResultBuilder.text('See the docs') })
  .photo({ photo_url: img, thumbnail_url: thumb, title: 'A photo' })
  .cachedSticker({ sticker_file_id: fileId })
  .build();
```

### IDs are handled for you

Every inline result needs a unique `id` (1–64 bytes). Omit it and the builder
auto-assigns `auto_0`, `auto_1`, … in order. Pass an explicit `id` to override
(it's validated against the 1–64 byte limit and throws `RangeError` if out of
range). Explicit and auto ids don't collide.

### Methods

| Group | Methods |
| --- | --- |
| Fresh (by URL) | `article`, `photo`, `gif`, `mpeg4Gif`, `video`, `audio`, `voice`, `document`, `location`, `venue`, `contact`, `game` |
| Cached (by `*_file_id`) | `cachedPhoto`, `cachedGif`, `cachedMpeg4Gif`, `cachedSticker`, `cachedDocument`, `cachedVideo`, `cachedVoice`, `cachedAudio` |
| Escape hatch | `add(result)` — append any fully-formed `InlineQueryResult` verbatim |
| Static helper | `InlineQueryResultBuilder.text(messageText, extra?)` → `InputTextMessageContent` |

`article` takes a `text` shorthand that builds a plain-text
`input_message_content` for you; pass `input_message_content` explicitly to
override it (e.g. a location/venue/contact message, or text with `parse_mode`).

```ts
.article({ title: 'Echo', text: 'hello' })                       // shorthand
.article({ title: 'Bold', input_message_content:
   InlineQueryResultBuilder.text('*hi*', { parse_mode: 'MarkdownV2' }) })
```

Attach an inline keyboard to any result with `reply_markup` — the
[`InlineKeyboardBuilder`](./BOT-API.md) output drops straight in:

```ts
.article({ title: 'Vote', text: 'Pick one',
  reply_markup: new InlineKeyboardBuilder().callback('A', 'a').build() })
```

## Answering a query

Answer within a few seconds, either from the context shorthand or the service:

```ts
// From a handler's ctx:
await ctx.answerInlineQuery(results, { cache_time: 0, is_personal: true });

// Or from anywhere holding TelegramBotService:
await this.bot.answerInlineQuery(inlineQueryId, results, { cache_time: 0 });
```

`TelegramBotService.answerInlineQuery` wraps failures in `TelegramBotApiError`
and records metrics like the other facade methods. Common `extra` fields:

| Field | Meaning |
| --- | --- |
| `cache_time` | Seconds Telegram caches the results client-side (default 300; use `0` while developing). |
| `is_personal` | Cache per-user instead of globally (results depend on the user). |
| `next_offset` | Pagination cursor — see below. |
| `button` | A button shown above the results (e.g. "switch to PM"). |

## Pagination

Telegram requests more results by re-sending the same query with the `offset`
you previously returned as `next_offset`. Read it with `@InlineQueryOffset()`,
and return an empty `next_offset` (the default) on the last page:

```ts
@InlineQuery()
async onQuery(
  @Ctx() ctx: Context,
  @InlineQueryText() text: string | undefined,
  @InlineQueryOffset() offset: string | undefined,
): Promise<void> {
  const page = Number(offset) || 0;
  const { results, hasMore } = await this.search(text ?? '', page);
  await ctx.answerInlineQuery(results, {
    next_offset: hasMore ? String(page + 1) : '', // '' (or omit) → no more pages
  });
}
```

## Multiple bots

Inline handlers honour `@TelegramUpdate({ bot })` scoping exactly like every
other decorator — a provider's inline handlers bind only onto its target bot. See
[MULTIPLE-BOTS.md](./MULTIPLE-BOTS.md).

## Environment variables

None specific to inline mode. The bot token is configured on `TelegramBotModule`
as usual (`BOT_TOKEN` in the examples).

## Security notes

- **All result URLs are public.** Telegram warns that every URL in an inline
  result is exposed to end users — never embed secrets, signed-but-sensitive
  links, or internal hostnames in `photo_url`, `thumbnail_url`, article `url`,
  etc.
- **Treat the query text as untrusted input.** `@InlineQueryText()` is raw user
  input from any chat; validate/escape before using it in queries, and set
  `parse_mode` deliberately (a stray `*`/`_` in user text can break Markdown).
- **`is_personal` for user-specific results.** If results depend on *who* asked,
  set `is_personal: true` so Telegram doesn't serve one user's cached results to
  another.

## How to extend

- **A result type the builder doesn't wrap** → use `.add(result)` with a
  fully-formed `InlineQueryResult` (its `id` is used as-is).
- **A new convenience method** → add it to `inline-query-result.builder.ts`
  following the existing `Extract<InlineQueryResult, { type: … }>` pattern, with a
  spec covering it. Keep deriving types from Telegraf (never import
  `@telegraf/types` outside the adapter boundary).
- **Custom dispatch behaviour** → the binding flows through the same registrar as
  every other handler; extend `TelegramBotUpdatesRegistrar.bind` if you need a new
  binding kind (see [BOT-UPDATE-DECORATORS.md](./BOT-UPDATE-DECORATORS.md)).
