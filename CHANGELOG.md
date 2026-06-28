# Changelog

All notable changes to `telenest` are documented here.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).
Each release also has full, auto-generated notes on the
[GitHub Releases](https://github.com/Aborii/nestjs-telegram/releases) page.

## [1.3.0] - 2026-06-25

Conversations, broader inbound coverage, and telemetry — closing the v1.3 roadmap
epic (#49). All items ship on the free Telegram API surface.

### Added

- Scene & wizard decorators (`@Scene` / `@WizardStep`) for declarative multi-step
  conversations (#41).
- Auto-registration of bot commands to Telegram from `@Command` metadata (#42).
- Richer inbound user-account updates — edited / deleted / chat-action events plus a
  catch-up buffer (#43).
- First-class inline mode (`@InlineQuery` / `@ChosenInlineResult`) with a result
  builder (#44).
- Typed callback-action router layered over the callback-data codec (#45).
- Automatic `FLOOD_WAIT` back-off/retry for MTProto user operations (#46).
- ORM-backed (SQL) session store (#47).
- Metrics exporter bridging to OpenTelemetry / Prometheus (#48).

### Changed

- Release/packaging-readiness pass (#51) and a security-hardening pass (#60).

### Fixed

- Correctness fixes across the bot and client sides (#52–#59, #63).

### Notes

- #31 (dynamic multi-tenant connections) was resolved **not planned** after a ToS review.

## [1.2.0] - 2026-06-23

The post-1.0 roadmap (epic #16) — a large batch of additive, backward-compatible features.

### Added

- First-class bot update decorators via `DiscoveryService` (#3).
- `validateWebAppInitData()` for Telegram Mini Apps (#4).
- Public testing utilities via the `telenest/testing` subpath (#5).
- Multiple named bots in one application (#8).
- Built-in webhook controller with secret-token validation (#9).
- Guards, interceptors & exception filters for updates (#10).
- Expanded Bot API coverage + convenience helpers — file download, callback-data
  codec, long-message split, 429 retry (#11).
- Expanded MTProto user operations — media, chats, message ops (#12), including
  progressive media streaming over HTTP Range (#34).
- Additional auth methods — QR login, bot-token, 2FA setup (#13).
- Additional session stores — Redis, key/value, encrypted-at-rest (#14).
- Observability — health indicators, metrics & tracing (#15).
- Multiple named MTProto user accounts in one application (#26).

### Changed

- CI pipeline + guarded npm publish workflow, ESLint + Prettier + import sorting (#7, #27).

## [1.1.0] - 2026-06-20

### Added

- Typed inbound updates for the MTProto user-account client: the `@OnUserMessage`
  decorator and the `TelegramUserService.updates$` observable, wired by a
  `DiscoveryService`-based registrar (#2).
- Subpath exports (`telenest/bot`, `/client`, `/common`) with `telegraf` and
  `telegram` as **optional** peer dependencies, guarded by an import-boundary test (#6).

### Fixed

- A `prepare` script now builds `dist` on install, so installs straight from GitHub
  ship a compiled, typed package.
- Reset `RegExp.lastIndex` in `@OnUserMessage` pattern matching so a shared global-flag
  pattern matches every message.

## [1.0.0] - 2026-06-20

First release — a fully-typed NestJS module covering both Telegram API surfaces.

### Added

- **Bot API (Telegraf):** `TelegramBotModule` (`forRoot` / `forRootAsync`) and a typed
  `TelegramBotService` facade with consistent `TelegramBotApiError` wrapping and
  polling/webhook launch wired into the Nest lifecycle; fluent
  `InlineKeyboardBuilder` / `ReplyKeyboardBuilder`.
- **MTProto user account (GramJS):** `TelegramClientModule` + `TelegramAuthService`
  (phone → code → 2FA login state machine) with a pluggable `SessionStore` (in-memory
  and atomic owner-only file store); `TelegramUserService` for dialogs, messages, and
  send-as-yourself; the `IGramClient` abstraction confining GramJS to a single adapter.
- **Shared:** typed `TelegramError` hierarchy, the umbrella `TelegramModule`, and
  runnable examples (login CLI + reference app module).

[1.3.0]: https://github.com/Aborii/nestjs-telegram/compare/v1.2.0...v1.3.0
[1.2.0]: https://github.com/Aborii/nestjs-telegram/compare/v1.1.0...v1.2.0
[1.1.0]: https://github.com/Aborii/nestjs-telegram/compare/v1.0.0...v1.1.0
[1.0.0]: https://github.com/Aborii/nestjs-telegram/releases/tag/v1.0.0
