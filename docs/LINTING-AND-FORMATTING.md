# Linting & Formatting

This project enforces its code conventions automatically with **ESLint** (rules)
and **Prettier** (formatting), wired so the two never disagree. ESLint turns the
hard rules in [`CLAUDE.md`](../CLAUDE.md) — no `any`, no `enum`, explicit public
types — into machine-checked errors and keeps imports sorted; Prettier owns all
whitespace/quote/comma formatting. Both are deterministic and runnable locally or
in CI.

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

| Tool         | Owns                                            | Config              |
| ------------ | ----------------------------------------------- | ------------------- |
| **ESLint**   | Code-correctness rules + import/export ordering | `eslint.config.js`  |
| **Prettier** | Pure formatting (quotes, commas, width, indent) | `.prettierrc.json`  |

`eslint-config-prettier` is loaded **last** in the ESLint flat config. It turns
off every ESLint rule that would conflict with Prettier, so running both never
produces fighting fixes. Lint failures are about *code*; format failures are
about *layout*.

## File Structure

```text
.
├── eslint.config.js     # ESLint 9 flat config — rules + import sorting + prettier-off
├── .prettierrc.json     # Prettier options (single quotes, trailing commas, 80 cols, LF)
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

Markdown is intentionally excluded (`.prettierignore`) so Prettier never reflows
the hand-authored docs or breaks Mermaid diagram fences.

## Import Sorting

`eslint-plugin-simple-import-sort` provides deterministic, **auto-fixable**
import and export ordering (`simple-import-sort/imports`,
`simple-import-sort/exports`). It groups third-party packages, then relative
imports, with a blank line between groups, and sorts alphabetically within each.
Run `npm run lint:fix` to apply.

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
