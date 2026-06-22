/**
 * @file eslint.config.js
 *
 * PURPOSE
 * -------
 * ESLint flat config (ESLint 9) that enforces this repository's hard
 * conventions in CI and locally. It turns the prose rules in `CLAUDE.md`
 * ("No enums", "No `any`", full typing) into machine-checked lint errors and
 * keeps import order deterministic.
 *
 * USAGE
 * -----
 *   npm run lint        # check (fails on any finding) — used by CI
 *   npm run lint:fix    # auto-fix what can be fixed (e.g. import order)
 *
 * Formatting concerns are owned by Prettier (`.prettierrc`); this config wires
 * in `eslint-config-prettier` last so the two tools never disagree.
 *
 * KEY EXPORTS
 * -----------
 * - default: the flat config array consumed by ESLint.
 */

const tseslint = require('typescript-eslint');
const simpleImportSort = require('eslint-plugin-simple-import-sort');
const eslintConfigPrettier = require('eslint-config-prettier');

module.exports = tseslint.config(
  // ── Ignore generated / non-source output ───────────────────────────────────
  {
    ignores: ['dist/**', 'coverage/**', 'node_modules/**'],
  },

  // ── Baseline: typescript-eslint recommended rules ──────────────────────────
  ...tseslint.configs.recommended,

  // ── Project conventions (apply to all TypeScript sources) ──────────────────
  {
    files: ['**/*.ts'],
    plugins: {
      // Deterministic, auto-fixable import/export ordering.
      'simple-import-sort': simpleImportSort,
    },
    rules: {
      // Hard rule: never `any`, explicit or via assertion.
      '@typescript-eslint/no-explicit-any': 'error',

      // Public surfaces must declare their types — no inferred boundaries.
      '@typescript-eslint/explicit-module-boundary-types': 'error',

      // Flag unused identifiers, but honor the repo's `_`-prefix convention for
      // deliberately-unused params/vars/caught errors (see CLAUDE.md code style).
      '@typescript-eslint/no-unused-vars': [
        'error',
        {
          argsIgnorePattern: '^_',
          varsIgnorePattern: '^_',
          caughtErrorsIgnorePattern: '^_',
        },
      ],

      // Hard rule: no `enum`. Model closed sets as an `as const` object plus a
      // derived union type instead (see CLAUDE.md, "No enums").
      'no-restricted-syntax': [
        'error',
        {
          selector: 'TSEnumDeclaration',
          message:
            'Do not use `enum`. Use an `as const` object plus a derived union type (see CLAUDE.md, "No enums").',
        },
      ],

      // Deterministic import/export ordering (auto-fixable via `lint:fix`).
      'simple-import-sort/imports': 'error',
      'simple-import-sort/exports': 'error',
    },
  },

  // ── Disable rules that conflict with Prettier (must stay last) ─────────────
  eslintConfigPrettier,
);
