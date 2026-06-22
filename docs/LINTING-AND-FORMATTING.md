# Linting & Formatting

This project enforces its code conventions automatically with **ESLint** (rules)
and **Prettier** (formatting), wired so the two never disagree. ESLint turns the
hard rules in [`CLAUDE.md`](../CLAUDE.md) — no `any`, no `enum`, explicit public
types — into machine-checked errors; Prettier owns all whitespace/quote/comma
formatting **and import ordering**. Both are deterministic and runnable locally
or in CI.

## Table of Contents

- [Architecture Overview](#architecture-overview)
- [File Structure](#file-structure)
- [Commands](#commands)
- [What ESLint Enforces](#what-eslint-enforces)
- [What Prettier Owns](#what-prettier-owns)
- [Import Sorting](#import-sorting)
- [Environment Variables](#environment-variables)
- [How To Extend](#how-to-extend)

## Architecture Overview

Two tools with a clean division of labor:

| Tool         | Owns                                              | Config             |
| ------------ | ------------------------------------------------- | ------------------ |
| **ESLint**   | Code-correctness rules (no `any`/`enum`, typing)  | `eslint.config.js` |
| **Prettier** | Formatting (quotes, commas, width, indent) + import order | `.prettierrc.json` |

`eslint-config-prettier` is loaded **last** in the ESLint flat config. It turns
off every ESLint rule that would conflict with Prettier, so running both never
produces fighting fixes. Lint failures are about *code*; format failures are
about *layout*.

## File Structure

```text
.
├── eslint.config.js     # ESLint 9 flat config — correctness rules + prettier-off
├── .prettierrc.json     # Prettier options (style + import sorting via @ianvs plugin)
└── .prettierignore      # Paths Prettier skips (dist, coverage, lockfile, *.md)
```

## Commands

| Task                                   | Command                |
| -------------------------------------- | ---------------------- |
| Lint (check only — fails on a finding) | `npm run lint`         |
| Lint and auto-fix what is fixable      | `npm run lint:fix`     |
| Format the whole repo in place         | `npm run format`       |
| Check formatting without writing (CI)  | `npm run format:check` |

`npm run lint` is the CI-friendly gate: it never auto-fixes, so an unfixable
violation (an `any`, an `enum`) fails the run instead of being silently rewritten.

## What ESLint Enforces

On top of `typescript-eslint`'s recommended set, the config adds the repo's hard
rules:

- **`@typescript-eslint/no-explicit-any: error`** — no `any`, explicit or via
  assertion. Use `unknown` at boundaries and narrow.
- **`no-restricted-syntax` on `TSEnumDeclaration`** — bans `enum`. Model closed
  sets as an `as const` object plus a derived union type (see `CLAUDE.md`,
  "No enums").
- **`@typescript-eslint/explicit-module-boundary-types: error`** — exported
  functions/methods must declare their parameter and return types.
- **`@typescript-eslint/no-unused-vars`** — flags dead identifiers, but honors
  the repo's `_`-prefix convention (`argsIgnorePattern: '^_'`) for deliberately
  unused params/vars/caught errors.

## What Prettier Owns

`.prettierrc.json` pins the style the codebase already used, so formatting is
explicit rather than relying on defaults:

- `singleQuote: true`, `semi: true`, `trailingComma: "all"`
- `printWidth: 80`, `tabWidth: 2`, `arrowParens: "always"`
- `endOfLine: "lf"` — commit content stays LF regardless of OS checkout settings.
- `plugins: ["@ianvs/prettier-plugin-sort-imports"]` — see [Import Sorting](#import-sorting).

Markdown is intentionally excluded (`.prettierignore`) so Prettier never reflows
the hand-authored docs or breaks Mermaid diagram fences.

## Import Sorting

Import ordering is owned by **Prettier**, via the
[`@ianvs/prettier-plugin-sort-imports`](https://github.com/IanVS/prettier-plugin-sort-imports)
plugin, so it is applied by the same `npm run format` pass as the rest of the
formatting (no separate `lint:fix` step). The order is configured in
`.prettierrc.json`:

```json
"importOrder": ["<BUILTIN_MODULES>", "<THIRD_PARTY_MODULES>", "", "^[.]"],
"importOrderParserPlugins": ["typescript", "decorators-legacy"]
```

- Node built-ins and third-party packages come first, then — after a blank line
  (the empty `""` group) — relative (`./`, `../`) imports, sorted alphabetically
  within each group. This reproduces the grouping the codebase already used.
- `importOrderParserPlugins` enables the TypeScript + legacy-decorator syntax
  this NestJS codebase relies on, so decorated classes parse correctly.

> Note: the plugin sorts **imports** only, not re-export (`export … from`)
> statements; barrel files (`index.ts`) keep their hand-authored export order.

## Environment Variables

None. Both tools are configured entirely by the files above and read no
environment variables.

## How To Extend

- **Add a lint rule:** add it to the `rules` block in `eslint.config.js`. If it
  is purely stylistic and Prettier already covers it, prefer letting Prettier own
  it (and keep `eslint-config-prettier` last).
- **Change formatting:** edit `.prettierrc.json`, then run `npm run format` once
  to reflow the repo so `format:check` stays green.
- **Exempt a path from formatting:** add it to `.prettierignore`.
- **Allow a justified rule violation:** use a scoped
  `// eslint-disable-next-line <rule> -- <reason>` comment with a real reason —
  never a blanket file-level disable.
