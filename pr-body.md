## Summary

Expands the Bot API surface and adds the convenience helpers requested in #11.
Everything was already reachable via `bot.telegram.*`; this adds typed,
error-wrapped facade methods plus four ergonomic helpers, all following the
existing facade conventions (Telegraf-derived signatures via
`Parameters`/`ReturnType`, every failure normalized to `TelegramBotApiError`).

## What changed

**Typed method coverage** (new delegates on `TelegramBotService`):

- Polls — `sendPoll`, `stopPoll`
- Stickers / reactions — `sendSticker`, `setMessageReaction`
- Forum topics — `createForumTopic`, `editForumTopic`, `closeForumTopic`,
  `reopenForumTopic`, `deleteForumTopic`
- Payments — `sendInvoice`, `createInvoiceLink`, `answerPreCheckoutQuery`
- Bot profile — `setChatMenuButton`/`getChatMenuButton`,
  `setMyDescription`/`getMyDescription`,
  `setMyShortDescription`/`getMyShortDescription`

**Convenience helpers:**

- `downloadFile(fileId)` → `Buffer` and `downloadFileStream(fileId)` →
  `ReadableStream` (resolve `getFileLink`, then `fetch`; non-2xx is wrapped).
- `encodeCallbackData` / `decodeCallbackData` — 64-byte-safe structured callback
  payloads (rejects oversized with a `RangeError`).
- `sendLongMessage(chatId, text, extra?)` — auto-splits on line boundaries so no
  part exceeds 4096 chars; sends sequentially to preserve order.
- `withRetry(fn, options?)` — honors Telegram's `429` `retry_after`; non-429
  errors propagate immediately.

The pure helpers (codec, splitter, retry) live in their own modules
(`callback-data.codec.ts`, `message-splitter.ts`, `retry.ts`) and are exported
from the package root, so they're usable without the service; the service
methods are thin wrappers over them. `TelegramBotApiError` now also carries
`retryAfterSeconds`, captured from a `429`.

## Notes / divergence from the issue

- Scope rounded out for completeness beyond the issue's literal list: added
  `reopenForumTopic`/`deleteForumTopic` (full topic lifecycle) and the `get*`
  pair for menu button + descriptions. All are trivial typed delegates.
- The codec/splitter/retry are implemented as **standalone pure functions**
  (exported) with the service exposing thin wrappers, rather than service-only
  methods — this keeps them unit-testable and reusable without DI while still
  satisfying "helpers on `TelegramBotService`".

## Verification

- typecheck: ✅ `npm run typecheck`
- tests: ✅ `npm test` — 52 suites, 467 tests; new specs for the codec, splitter,
  retry, the new delegates (data-driven), and the service helpers (mock Telegraf
  + stubbed `fetch`, **no network**)
- lint: ✅ `npm run lint`
- build: ✅ `npm run build` (emits `.d.ts`)
- coverage: new files at/near 100% (retry 100%, codec/splitter 100% lines);
  overall statements 98.6%

## Docs

`docs/BOT-API.md` updated: method-reference table, a new "Convenience helpers"
section (§9), the `retryAfterSeconds` error field, and the source-file list.

Closes #11
