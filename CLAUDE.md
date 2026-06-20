# CLAUDE.md

Project instructions for Claude Code working in this repository. These rules are
**mandatory** and override default behavior. (Converted from the Copilot
instructions under `.github/`; that content is mirrored here for Claude.)

---

## Project overview

`nestjs-telegram` is a reusable, fully-typed **NestJS library** wrapping the two
Telegram API surfaces:

- **Bot API** (via Telegraf) — a normal bot. See `src/lib/bot`.
- **MTProto user account** (via GramJS, the `telegram` package) — sign in as your
  own account and control it. See `src/lib/client`.

The library lives under `src/lib`; the public entry point is `src/index.ts`. The
`src/bots` + `src/app.module.ts` + `src/main.ts` files are a runnable **demo app**
(decorator-style, using `nestjs-telegraf`) kept as an example and excluded from the
published build. `examples/` holds a login CLI and a reference app module.

### Layout

```text
src/
  index.ts                      # public package barrel -> ./lib
  lib/
    common/                     # error hierarchy + shared scalar types
    bot/                        # TelegramBotModule, TelegramBotService, keyboards
    client/                     # TelegramClientModule, auth/user services, GramJS adapter
      session/                  # SessionStore + in-memory/file implementations
    telegram.module.ts          # umbrella TelegramModule.forRoot
  bots/ , common/config/        # demo app (example only)
examples/                       # login CLI + reference wiring
docs/                           # feature documentation (see rules below)
```

### Key architectural rule

`IGramClient` (`src/lib/client/gram-client.interface.ts`) is the seam between the
MTProto services and GramJS. **`GramJsClientAdapter` is the only file allowed to
import `telegram`.** Services depend on `IGramClient` and return library-owned DTOs
(`gram-client.types.ts`), never raw GramJS `Api.*` objects. Preserve this boundary.

`telegraf` and `telegram` are **peerDependencies**.

## Commands

| Task | Command |
| --- | --- |
| Build the library to `dist` (with `.d.ts`) | `npm run build` |
| Typecheck everything (src + tests + examples) | `npm run typecheck` |
| Run tests | `npm test` |
| Run tests with coverage | `npm run test:cov` |
| Mint an MTProto session string (interactive) | `npm run login` |
| Run the demo app | `npm run start:dev` |

Always run `npm run typecheck` and `npm test` before considering a change done.
Strict TypeScript is the gate (there is no ESLint config in this repo).

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
on (`tsconfig.json`). Treat `@typescript-eslint/no-explicit-any` as an error in
spirit even though ESLint is not wired up.

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
- [ ] Non-obvious logic commented; section dividers in long functions.
- [ ] Tests added/updated; `npm run typecheck` and `npm test` pass.
- [ ] `docs/<FEATURE>.md` created or updated for new/changed features.
