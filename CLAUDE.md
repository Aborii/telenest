# CLAUDE.md

Project instructions for Claude Code working in this repository. These rules are
**mandatory** and override default behavior. (Converted from the Copilot
instructions under `.github/`; that content is mirrored here for Claude.)

---

## Project overview

`telenest` is a reusable, fully-typed **NestJS library** wrapping the two
Telegram API surfaces:

- **Bot API** (via Telegraf) — a normal bot. See `src/lib/bot`.
- **MTProto user account** (via GramJS, the `telegram` package) — sign in as your
  own account and control it. See `src/lib/client`.

The library lives under `src/lib`; the public entry point is `src/index.ts`. The
`src/bots` + `src/app.module.ts` + `src/main.ts` files are a runnable **demo app**
(decorator-style, using `nestjs-telegraf`) kept as an example and excluded from the
published build. `examples/` holds a login CLI and a reference app module.

### Scope & non-goals

- **Telegram Payments / invoices are in scope.** The library wraps the Bot API
  payment surface — `sendInvoice`, `createInvoiceLink`, `answerPreCheckoutQuery`,
  and (as they are built out) successful-payment handling, Telegram Stars, and
  paid media. These do not require the *bot operator* to hold a paid tier; the
  bot collects payments from users. Roadmap/expansion is tracked in #62.
- **Premium-subscription-gated capabilities remain out of scope** where they
  simply cannot function without the *end user* (or bot) holding a paid Telegram
  Premium subscription — e.g. premium-only stickers/emoji or premium-raised
  limits. Don't build features whose only purpose is to require Premium to work.

If a request touches a Premium-gated capability that can't work for a free user,
drop that part and note why.

### Layout

```text
src/
  index.ts                      # public package barrel -> ./lib
  lib/
    common/                     # error hierarchy + shared scalar types
      observability/            # health, metrics, OpenTelemetry tracer bridge
    bot/                        # TelegramBotModule, TelegramBotService, keyboards
      updates/                  # @TelegramUpdate decorators, registrar, guards/filters, execution
      web-app/                  # validateWebAppInitData (Mini App init-data)
      webhook/                  # webhook controller, guard, registrar, secret-token
      (callback-data.codec, message-splitter, retry, health, metrics-middleware)
    client/                     # TelegramClientModule, auth/user services, GramJS adapter
      updates/                  # @OnUserMessage inbound dispatch
      session/                  # SessionStore + 5 stores (memory/file/key-value/redis/encrypted)
    testing/                    # telenest/testing — mocks + DTO builders
    telegram.module.ts          # umbrella TelegramModule.forRoot
  bots/ , common/config/        # demo app (example only)
examples/                       # login CLI (+ QR), decorator/enhancer examples, reference wiring
docs/                           # feature documentation (see rules below)
```

### Internal decoupling (Bot API ⟷ MTProto client) — keep them independent

The two sides MUST stay independent so each is usable (and one day publishable) on
its own. This is a hard architectural rule, not a preference:

- **No cross-imports.** Nothing under `src/lib/bot/**` may import from
  `src/lib/client/**`, and vice-versa. The two sides share code **only** through
  `src/lib/common/**`.
- **SDKs stay confined.** Only `src/lib/client/gramjs-client.adapter.ts` (and its
  co-located spec, for fixtures) may import `telegram` (GramJS); only
  `src/lib/bot/**` may import `telegraf`. MTProto services depend on the
  `IGramClient` seam (`gram-client.interface.ts`) and return library DTOs
  (`gram-client.types.ts`), never raw GramJS `Api.*` objects.
- **The umbrella `TelegramModule` only composes** the two feature modules
  (`TelegramModule.forRoot({ bot?, client? })`) — never add logic there that
  couples them.
- **`telegraf` and `telegram` are optional peer dependencies** and neither side may
  take a hard runtime dependency on the other's SDK. Subpath exports
  (`telenest/bot`, `/client`, `/common`, `/testing`) keep each side
  importable on its own.

The boundary is enforced automatically by `src/lib/import-boundaries.spec.ts`. To
check by hand, both of these must return nothing:

```bash
grep -rn "from '\.\./client" src/lib/bot
grep -rn "from '\.\./bot" src/lib/client
```

## Non-negotiables

Hard rules — never violate them, even under time pressure. The detailed sections
below expand each one.

- **No TypeScript `enum`, ever.** Model closed sets as an `as const` object plus a
  derived union type (and a derived values array when you need the list). See
  "No enums".
- **No `any`** (explicit or implicit) — use `unknown` at boundaries and narrow.
- **Keep the Bot and MTProto sides decoupled** — see "Internal decoupling".
- **No paid / premium Telegram features** — free API surface only; never build or
  plan payments, Telegram Stars, or Premium-gated capabilities. See "Scope & non-goals".
- **Full JSDoc** on every file, export, and non-obvious type member.
- **Tests never hit the network**; co-locate `*.spec.ts`; keep the coverage bar.
- **Feature work targets `dev`, never `main`** — see "Branching & releases".
- **Sign commits** with the dedicated key; reference the issue and add `Closes #n`.
- **`npm run typecheck` and `npm test` must both pass** before every commit.

## Commands

| Task | Command |
| --- | --- |
| Build the library to `dist` (with `.d.ts`) | `npm run build` |
| Typecheck everything (src + tests + examples) | `npm run typecheck` |
| Run tests | `npm test` |
| Run tests with coverage | `npm run test:cov` |
| Mint an MTProto session string (interactive) | `npm run login` |
| Run the demo app | `npm run start:dev` |

Always run `npm run typecheck`, `npm run lint` and `npm test` before considering a
change done. Strict TypeScript and ESLint (`eslint.config.js`) are the gate; CI also
runs `npm run build` and `npm run format:check`.

---

## Branching & releases

This repo uses a `dev`-based flow:

- **`dev` is the integration branch and the merge base.** GitHub's default branch
  is `main`, so always pass `--base dev`. All feature/fix work branches off `dev` and opens PRs **against `dev`**
  (`gh pr create --base dev`). Never open feature PRs against `main`.
- **`main` is release-only.** It receives `dev` *only* via a release merge, so it
  always reflects the latest released version.
- **Cutting a release:** merge `dev` → `main`, then tag `vX.Y.Z` and create a
  GitHub release from `main`. Pushing the `vX.Y.Z` tag triggers the
  `Release (npm publish)` workflow, which publishes `telenest` to the **public
  npm registry** with provenance via **npm Trusted Publishing (OIDC)** — there is
  **no `NPM_TOKEN` secret**. Auth is a short-lived OIDC token tied to this repo +
  `release.yml`; the Trusted Publisher must stay configured for the package on
  npmjs.com (org `Aborii`, repo `telenest`, workflow `release.yml`).
- For any feature/fix, follow the feature-from-issue flow in the global
  `~/.claude/CLAUDE.md` (branch off `dev` → implement → verify → commit → PR into
  `dev` → self-review → fix → resolve).

---

## Documentation & comments — required for everything

Every file, function, class, method, constant, and type that you create or
significantly modify **must** include complete documentation and inline comments.

### File-level

Every source file starts with a JSDoc/TSDoc block covering:

- **PURPOSE** — what this file does and why it exists.
- **USAGE** — how to import/use it (examples if applicable).
- **ENVIRONMENT VARIABLES** — any env vars the file reads (scripts/utilities only).
- **KEY EXPORTS** — list of main exports and their roles (modules/libs only).

### Functions & methods

Every function and method has a JSDoc block with:

- A one-line summary sentence (before any tags).
- `@param` for every parameter (name + what it represents).
- `@returns` describing the return value.
- `@throws` for every exception that can propagate to the caller (use
  `@throws Never.` when it cannot throw).
- An `@example` block for non-trivial public APIs.

### Classes

Document what the class represents, constructor `@param`s, and notable lifecycle
concerns (e.g. "disconnects on `onModuleDestroy`").

### Interfaces & types

Every exported `interface`, `type`, and union has a JSDoc block plus an inline
comment on **every member** that is not self-evident from its name.

### Inline comments

- Comment above (not beside) any non-obvious logic.
- Use `// ── Section title ──────` dividers to separate logical blocks in long
  functions.
- Never leave a `TODO`/`FIXME` without an explanation.

### Constants

Every exported constant and non-trivial module-level variable has a one-line
`/** … */` comment explaining what it holds and where the value comes from.

---

## No enums

- Never introduce a JavaScript/TypeScript `enum`.
- Model closed sets with an `as const` record plus a derived union type, e.g.:

  ```ts
  export const PARSE_MODES = { MARKDOWN: 'Markdown', HTML: 'HTML' } as const;
  export type ParseMode = (typeof PARSE_MODES)[keyof typeof PARSE_MODES];
  ```

- When validation needs the allowed values, export an array derived from the
  record (`Object.values(MY_RECORD) as readonly MyType[]`).
- If you touch existing enum-based code, convert it to this pattern.

## Type safety

`strict`, `noImplicitAny`, `strictNullChecks`, and `noUncheckedIndexedAccess` are
on (`tsconfig.json`). `@typescript-eslint/no-explicit-any` is an error in
`eslint.config.js`, and CI fails on `npm run lint`.

- **No `any`** — explicit or implicit — anywhere in source. Never cast to `any`
  (`value as any`). When a third-party API returns a broad/`unknown` type, contain
  the narrowing in a typed helper at the call site.
- **`unknown` over `any` at boundaries** (parsed JSON, webhook payloads, caught
  errors); narrow before use.
- **Caught errors**: always narrow — `const message = error instanceof Error ?
  error.message : String(error);`. Never read `.message` off `unknown`.
- **Type assertions**: only use `as` when you have narrowed the value yourself and
  the compiler cannot infer it; add an inline comment when non-obvious.
- **Generics**: prefer explicit generic params over wide return types. Avoid
  `object`, `{}`, or `Record<string, any>` as catch-alls.

## Code style

- `camelCase` for variables/functions/methods; `PascalCase` for classes/interfaces/
  types; `SCREAMING_SNAKE_CASE` for constants and environment variables.
- File names are `kebab-case` and reflect their contents.
- Prefer `const`; never `var`.
- Private class fields start with an underscore (`_cache`).
- 2-space indentation; never tabs.
- `async/await` over raw promise chains; always handle errors.
- Template literals over string concatenation.
- A single statement in an `if` omits the braces:

  ```ts
  if (condition) return value;
  ```

---

## Testing conventions

- Jest + `ts-jest`; specs are co-located as `*.spec.ts` next to the code.
- **No test may hit the network.** For the Bot API side, use a mock `Telegraf`
  (or mock `TelegramBotService`). For the MTProto side, supply a fake
  `IGramClient` via `options.clientFactory`, or override the `TELEGRAM_GRAM_CLIENT`
  provider in a Nest `TestingModule` with `autoConnect: false`.
- Maintain full coverage: every source file under `src` (except barrels,
  `*.module-definition.ts`, `src/main.ts`, and `src/app.module.ts`) should have
  tests. Run `npm run test:cov` to check.
- Test behavior, not implementation detail; cover error paths and edge cases.

## Feature documentation

When you add a new feature or make a significant change:

1. **New feature → new doc** at `docs/<FEATURE-NAME>.md` (SCREAMING-KEBAB-CASE).
2. **Significant change → update** the relevant `docs/*.md`; never leave stale info.
3. Each doc includes: title + one-paragraph description, Table of Contents,
   Architecture Overview, File Structure (annotated tree), Environment Variables,
   Flow Diagrams / Step-by-Step (Mermaid welcome), HTTP/API Reference (if any),
   Security Notes (if any), and How To Extend.

## Exploring the codebase

Use Claude Code's own tools: `Grep` for symbols/strings, `Glob` for file patterns,
`Read` for files. Start from `src/index.ts` (public surface) and the module files
(`*.module.ts`). When changing the MTProto side, remember the `IGramClient` seam —
follow the interface, not GramJS internals.

---

## Pre-finalize checklist

- [ ] File-level JSDoc present.
- [ ] Every function/method has JSDoc with `@param`/`@returns`/`@throws`.
- [ ] Every exported type/interface documented, members commented.
- [ ] No `any`; no `enum`; secrets (tokens, session strings) never logged.
- [ ] Bot ⟷ client decoupling preserved (no cross-imports; SDKs confined).
- [ ] Non-obvious logic commented; section dividers in long functions.
- [ ] Tests added/updated; `npm run typecheck` and `npm test` pass.
- [ ] `docs/<FEATURE>.md` created or updated for new/changed features.
- [ ] Branch is off `dev` and the PR targets `dev` (not `main`).

<!-- first-pass:project:start (written once by the setup-first-pass skill; yours to edit, re-runs keep it) -->

### This repo (first-pass)

- **What it is:** `telenest` (npm package, GitHub `Aborii/telenest`): a published NestJS library for the Telegram Bot API (Telegraf, `src/lib/bot`) and MTProto user accounts (GramJS, `src/lib/client`), sharing only `src/lib/common`.
  - `src/main.ts`, `src/app.module.ts` and `src/bots/` are an unpublished demo app. `examples/` holds the login CLIs.
  - npm (`package-lock.json`), Node >= 20, Jest + ts-jest. A downstream NestJS app uses it through a linked folder.
- **CI's checks** (what must pass before a merge): `.github/workflows/ci.yml`, job `build-and-test`, runs on Node 20.x and 22.x. The `dev` branch requires both checks ("Node 20.x", "Node 22.x"), and the branch must be up to date.
  - CI runs `npm ci` (whose `prepare` script also builds `dist`), then `npm run typecheck`, `npm run lint`, `npm run format:check` (advisory: `continue-on-error`), `npm run test:cov` and `npm run build`.
  - The local equivalent is the same commands, after `npm install` or `npm ci`.
  - `codeql.yml` also scans PRs to `dev`/`main` and runs weekly. It has no local step.
- **Run one test file:** `npx jest src/lib/bot/retry.spec.ts`. Add `-t "<test name>"` for one test.
- **Real tests** (the layer that catches what mocks miss): `src/lib/bot/webhook/telegram-webhook.integration.spec.ts` boots a real Nest HTTP app on loopback with a faked Telegraf. It runs inside `npm test`.
  - Nothing runs against real Telegram. `src/lib/client/gramjs-client.adapter.ts` is covered only by fixture specs, so GramJS wire behaviour is only checked by a manual live run, which needs a yes.
- **What they need running, and how to start and stop it:** none. The webhook spec starts and closes its own app on an ephemeral 127.0.0.1 port. The Redis/ORM/key-value session stores use in-memory fakes, and the file store uses the OS temp folder.
- **Looking at the UI running** (how a screen this repo changes is opened and seen): none: no UI. The TypeDoc API reference is built from the JSDoc (`npm run docs:api` writes `docs/api`). `docs.yml` publishes it to GitHub Pages on every push to `main`.
- **Test limits** (what never to run here, and how much at once):
  - Never run `npm run start:dev`, `npm run login` or `examples/qr-login.example.ts` as a test (see "Local runs that reach real people").
  - Never run `npm run git:release`: it publishes.
  - The repo sets no worker limit. The full suite is 86 spec files.
- **Heavy runs** (what they are here and their limits; how this machine runs them is the machine block's): the full Jest suite and `npm run test:cov` (86 spec files, 1,000+ tests); `npm run build` (`tsc -p tsconfig.build.json`); `npm run docs:api` (TypeDoc); `npm ci`/`npm install` (they run `prepare`, which builds). The repo sets no limits of its own.
- **Local runs that reach real people** (what a local server, worker or test run sends for real, and the empty keys or switches that stop it):
  - **Tests** (`npm test`, `npm run test:cov`): none found. Every Telegram transport is faked (`src/lib/testing/`, `launch: false`, `autoConnect: false`). But nothing blocks a socket: `test/jest-setup.ts` only loads `reflect-metadata`.
  - **`npm run start:dev`** (demo app): long-polls Telegram as two real bots and replies to real users. It reads `ECHO_BOT_TOKEN` and `GREETER_BOT_TOKEN`. With `ECHO_BOT_WEBHOOK_DOMAIN`/`GREETER_BOT_WEBHOOK_DOMAIN` set, it also calls `setWebhook`, which moves that bot's live updates away from wherever they go now.
    - The stop is to leave both tokens unset, so boot fails at `getOrThrow`.
    - The placeholder values in `.env.example` are not a stop: they still call api.telegram.org.
    - With real tokens it needs a yes.
  - **`npm run login`** (`examples/login-cli.ts`) and **`examples/qr-login.example.ts`**: sign in to a real Telegram account over MTProto with `TG_API_ID`/`TG_API_HASH` and send a login code to `TG_PHONE`. With `TG_SESSION` set, they act as that account.
    - The stop is an empty `TG_API_ID` or `TG_API_HASH`, which throws before connecting (`examples/login-cli.ts:52`).
    - These always need a yes.
  - Both examples load `.env` through `dotenv/config`. No `.env` is committed.
  - **Publishing**: `npm run git:release` pushes the `v*` tag, and that triggers `.github/workflows/release.yml` → `npm publish` (public npm, cannot be undone). A push to `main` deploys the docs site. Both need the owner's yes.
- **Monitoring** (where a swallowed error must end up): none of its own, since it is a library. An error it swallows must go to Nest's `Logger` or to the metrics/tracer/health hooks in `src/lib/common/observability/`. The consuming app decides where those end up.
- **Words live in:** `README.md`, `docs/*.md` (one per feature), `CHANGELOG.md`, the JSDoc that becomes the TypeDoc site, and error messages and codes in `src/lib/common/telegram.errors.ts`.
  - Consuming apps map these error codes and DTO fields to its own user-facing words.
- **The same job in two places** (a change to one needs the other):
  - `src/lib/bot/retry.ts` (`withRetry`, 429) and `src/lib/client/retry.ts` (`withClientRetry`, FLOOD_WAIT).
  - A new MTProto method needs four places: `gram-client.interface.ts` (`IGramClient`), `gramjs-client.adapter.ts`, `telegram-user.service.ts` and `src/lib/testing/mock-gram-client.ts`.
  - `TelegramBotService` and `src/lib/testing/mock-telegraf.ts`.
  - The six `SessionStore` implementations in `src/lib/client/session/`: memory, file, key-value, redis, encrypted, and orm (orm extends key-value).
  - `telegram-bot.health.ts` and `telegram-client.health.ts`; the bot metrics middleware and the client user metrics.
  - The bot `updates/` decorators and the client `updates/` decorators. They are kept apart on purpose, so a shared behaviour change goes in both.
  - `CLAUDE.md` and `.github/copilot-instructions.md` (plus `.github/instructions/typescript.instructions.md`).
  - `.github/dependabot.yml` on `dev` and on `main` (Dependabot reads only the default branch's copy).
  - Release gates: `ci.yml`, `release.yml` (typecheck, test and build, but no lint) and `scripts/release.mts`.
  - `package-lock.json` and `pnpm-lock.yaml` (both tracked).
- **Extra pre-mortem cases** (this repo's own ways to run twice, end, or scale):
  - A webhook handler that throws returns 500, and Telegram then redelivers the same update. The handler runs again (`telegram-webhook.controller.ts:87`), and nothing dedupes by `update_id`.
  - Two processes polling one bot token get a `409` (deploy overlap, or rotating the token in the runtime bot).
  - Two connections on one MTProto session string can get the auth key revoked, which signs the account out.
  - A caller that wraps a send in its own retry after a timeout sends twice. The library's helpers retry only on 429/FLOOD_WAIT.
  - A long text split by `splitMessageText` goes out as several messages. A failure part-way leaves a partial set.
  - Several named bots or accounts in one process.
  - Concurrent `FileSessionStore` writes: last writer wins.
- **Owner rules:**
  - GitHub's default branch is `main`, which is release-only. Feature PRs go `--base dev`. `main` lagging `dev` is correct.
  - Dependabot security PRs target `main` by design.
  - Never touch a Dependabot branch by hand. No `gh pr update-branch` and no pushes: comment `@dependabot rebase` only.
  - A `dependabot.yml` change needs identical PRs to `dev` and `main`.
  - CI often queues for 20+ minutes. `BLOCKED` with an empty check list means "not started yet".
  - Each merge to `dev` puts the other PRs out of date, so combine related one-line PRs into one branch.
  - Commit messages go in a file and `git commit -F <file>`. A heredoc on stdin hangs with gpg.
  - `git show origin/main:path` breaks in the Bash tool. Use `gh api repos/Aborii/telenest/contents/<path>?ref=<branch>`.
  - To refresh `dist` for the linked consumer, run `npx tsc -p tsconfig.build.json`. Never `pnpm build`: its clean step wipes `dist` and the run can die.
  - Consumers import bot symbols from `telenest/bot`, never the root barrel, because the root loads the optional `telegram` peer.
  - When work in a consuming app needs a telenest change, open an `Aborii/telenest` issue (real labels, grounded in source) instead of patching. The owner implements it.
  - A live check never makes a real account write (join, send, pin) without a yes.
  - Releases (`npm run git:release`, the tag push, `npm publish`) and pushes to `main` are the owner's call.
- **Invariants:** `INVARIANTS.md`

<!-- first-pass:project:end -->

@INVARIANTS.md
