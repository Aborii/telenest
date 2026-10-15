# Invariants

What this system must never break, whatever the feature. Every change is checked against
the ones it touches (the pre-mortem names them; the breaker checks them). Each invariant
says what holds it today and where it is known to break.

- When a fix lands, move its id out of "Known breaks".
- When a new break is found, add it.
- An invariant held only by convention is a candidate for a check that makes breaking it
  fail CI: a test, a lint rule, a database constraint, or a shared helper that is the only
  way to do the thing.

<!-- One entry per invariant:

1. **<One sentence the system must always keep true.>**
   Held by: <the code, constraint, helper or test that enforces it; "convention only"; or "nothing yet">
   Known breaks: <issue ids or file:line, or "none known">
-->

1. **A write to Telegram (send, edit, delete, pin, invoice, reaction) is made at most once per call: the library retries only when Telegram refused it with `429 retry_after` or `FLOOD_WAIT`, only when the caller opts in, and never after a timeout or a dropped connection.**
   Held by: `src/lib/client/retry.ts:148-182` (non-flood errors rethrown at :164, opt-in per :17-20); `src/lib/bot/retry.ts` (only `retry_after`); `src/lib/client/retry.spec.ts`, `src/lib/bot/retry.spec.ts`, `src/lib/client/telegram-user.retry.spec.ts`
   Known breaks: none known

2. **Every connection to Telegram has a deadline, so a hung connect or request cannot stall a caller forever.**
   Held by: connect only, and only when the consumer sets `connectTimeoutMs` (`src/lib/client/telegram-client.options.ts:122`, `src/lib/client/gramjs-client.adapter.ts:321-346`); per-request deadlines are left to GramJS and Telegraf defaults: nothing yet in the library
   Known breaks: none known

3. **One bot token is polled by one process and one MTProto session is used by one connection; on shutdown the poller stops and the connection closes.**
   Held by: `src/lib/bot/telegram-bot.service.ts:147-197` (stop on module destroy); `src/lib/client/telegram-client.lifecycle.ts:56-57` (disconnect); the runtime bot detects a second poller's `409` and reports `error` (`src/lib/bot/runtime/telegram-bot-runtime.service.ts:70-95`) but cannot prevent it; one session string in two processes: nothing yet (left to the consumer)
   Known breaks: none known

4. **A Telegram failure never looks like an empty result: it is thrown as a typed error (`TelegramBotApiError`, `TelegramClientError`, `TelegramAuthError`) carrying its code, and a lost authorization is recognisable by `isAuthorizationLostError`.**
   Held by: `src/lib/common/telegram.errors.ts` (`isTelegramError` :304, `TELEGRAM_AUTH_LOSS_RPC_CODES` :313, `isAuthorizationLostError` :352); error mapping in `src/lib/client/gramjs-client.adapter.ts`; `src/lib/common/telegram.errors.spec.ts`
   Known breaks: none known

5. **Every error the library catches and does not rethrow is logged through Nest's `Logger` or reported to the metrics/tracer hooks, so the consuming app can see it.**
   Held by: convention only (`Logger` in the bot service, update registrars, handler dispatch, exception filter, webhook guard and registrar, auth service, client factory); hooks in `src/lib/common/observability/`
   Known breaks: none known

6. **Logging out ends the session at Telegram and deletes the stored session from the configured store.**
   Held by: `src/lib/client/telegram-auth.service.ts:346-350` (`logOut` calls `client.logOut()` then `sessionStore.clear()`); `src/lib/client/telegram-auth.service.spec.ts`
   Known breaks: none known

7. **A webhook update is handled only with the right secret token, and Mini App init data is trusted only with a valid HMAC that is not too old; both are compared in constant time.**
   Held by: `src/lib/bot/webhook/telegram-webhook.guard.ts:90` with `src/lib/bot/webhook/secret-token.ts:72-83`; `src/lib/bot/web-app/validate-web-app-init-data.ts:115-141` (24 h default `maxAgeSeconds`, constant-time compare); `src/lib/bot/webhook/telegram-webhook.integration.spec.ts`. Express parses the body before the guard runs (Nest's default size limit applies)
   Known breaks: none known

8. **The published API keeps its meaning within a major version: exports, subpath entries (`telenest/bot`, `/client`, `/common`, `/testing`), DTO fields, error codes and id formats change only in a new major, and consumers (the coming-manager API server) are updated with it.**
   Held by: convention only; the `exports` and `typesVersions` maps in `package.json`; no API snapshot or exports test
   Known breaks: none known

9. **Each named bot or account gets its own client, session store and services, so a call made through one name never reaches another bot or account.**
   Held by: per-name injection tokens (`src/lib/bot/telegram-bot.tokens.ts:101-198`, `src/lib/client/telegram-client.tokens.ts:101-204`); `src/lib/bot/telegram-bot.multi-bot.spec.ts`, `src/lib/client/telegram-client.multi-account.spec.ts`
   Known breaks: none known

10. **Bot tokens, session strings, `api_hash`, login codes and 2FA passwords never appear in logs or error messages; phone numbers appear only masked; a session written to disk is owner-only, and encrypted when the consumer wraps the store in `EncryptedSessionStore`.**
    Held by: `maskPhoneNumber` (`src/lib/common/phone.ts:28`, used at `src/lib/client/telegram-auth.service.ts:168`); `FileSessionStore` writes `0o600` via temp file and rename (`src/lib/client/session/file-session-store.ts:85-95`); AES-256-GCM in `src/lib/client/session/encrypted-session-store.ts:51,155-156` (opt-in: the other stores keep the session in plain text); "never logged" is convention only (`CLAUDE.md` pre-finalize checklist)
    Known breaks: none known

11. **The Bot API side and the MTProto side never import each other or each other's SDK; `telegram` (GramJS) is imported only in `gramjs-client.adapter.ts`, and MTProto services return library DTOs, never raw GramJS `Api.*` objects.**
    Held by: `src/lib/import-boundaries.spec.ts:102-128` (cross-side imports and each side's SDK); keeping GramJS to the one adapter file inside `src/lib/client` is convention only (the spec lets any client file import `telegram`)
    Known breaks: none known

12. **An id handed to a consumer for opening a chat (`peerIdMarked`, `forward.fromId`) is the marked form (`-100…` for channels, `-…` for groups); the raw form from `peerToString` is never used to address a peer.**
    Held by: `markedPeerId` in `src/lib/client/gramjs-client.adapter.ts:1868` (used at :1681 and :1845); `src/lib/client/gramjs-client.adapter.spec.ts`
    Known breaks: none known
