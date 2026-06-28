/**
 * @file src/lib/import-boundaries.spec.ts
 *
 * PURPOSE
 * -------
 * Enforces the Bot ⟷ MTProto-client decoupling (see CLAUDE.md) as an executable
 * rule, which is also what makes the subpath exports safe: importing
 * `telenest/bot` must never pull in GramJS (`telegram`), and
 * `telenest/client` must never pull in Telegraf. This test scans the
 * source of each side and fails if a forbidden import appears.
 */

import { readdirSync, readFileSync } from 'node:fs';
import { join, relative } from 'node:path';

/** Absolute path to `src/lib` (this file's directory). */
const LIB_DIR = __dirname;

/**
 * Recursively collects non-spec, non-declaration `.ts` source files under a dir.
 *
 * @param dir - Directory to walk.
 * @returns Absolute paths of the source files found.
 * @throws Never.
 */
function collectSourceFiles(dir: string): string[] {
  const files: string[] = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) {
      files.push(...collectSourceFiles(full));
    } else if (
      entry.name.endsWith('.ts') &&
      !entry.name.endsWith('.spec.ts') &&
      !entry.name.endsWith('.d.ts')
    ) {
      files.push(full);
    }
  }
  return files;
}

/**
 * Extracts the module specifiers of every *real* import/require in a source
 * file. Block comments (JSDoc, which may contain `{@link import('...')}`) are
 * stripped first so type-only references are not mistaken for runtime imports.
 *
 * @param source - The file's TypeScript source.
 * @returns The list of imported module specifiers.
 * @throws Never.
 */
function extractSpecifiers(source: string): string[] {
  const code = source.replace(/\/\*[\s\S]*?\*\//g, '');
  const specifiers: string[] = [];
  const patterns = [
    /\bfrom\s*['"]([^'"]+)['"]/g,
    /\bimport\s*\(\s*['"]([^'"]+)['"]\s*\)/g,
    /\brequire\s*\(\s*['"]([^'"]+)['"]\s*\)/g,
    /\bimport\s+['"]([^'"]+)['"]/g,
  ];
  for (const pattern of patterns) {
    let match: RegExpExecArray | null;
    while ((match = pattern.exec(code)) !== null) {
      const specifier = match[1];
      if (specifier) specifiers.push(specifier);
    }
  }
  return specifiers;
}

/**
 * Lists `"<file> imports <specifier>"` for every forbidden import on one side.
 *
 * @param dir - Directory to scan (e.g. `bot`).
 * @param isForbidden - Predicate marking a specifier as a boundary violation.
 * @returns Human-readable violation strings (empty when the boundary holds).
 * @throws Never.
 */
function findViolations(
  dir: string,
  isForbidden: (specifier: string) => boolean,
): string[] {
  const violations: string[] = [];
  for (const file of collectSourceFiles(dir)) {
    for (const specifier of extractSpecifiers(readFileSync(file, 'utf8'))) {
      if (isForbidden(specifier))
        violations.push(`${relative(LIB_DIR, file)} imports "${specifier}"`);
    }
  }
  return violations;
}

/** True when `specifier` references GramJS (`telegram` / `telegram/*`). */
const importsGramJs = (specifier: string): boolean =>
  specifier === 'telegram' || specifier.startsWith('telegram/');

/** True when `specifier` references Telegraf (`telegraf` / `telegraf/*`). */
const importsTelegraf = (specifier: string): boolean =>
  specifier === 'telegraf' || specifier.startsWith('telegraf/');

describe('import boundaries (Bot ⟷ MTProto client decoupling)', () => {
  it('the bot side never imports GramJS or the client side', () => {
    const violations = findViolations(
      join(LIB_DIR, 'bot'),
      (s) => importsGramJs(s) || s.includes('../client'),
    );
    expect(violations).toEqual([]);
  });

  it('the client side never imports Telegraf or the bot side', () => {
    const violations = findViolations(
      join(LIB_DIR, 'client'),
      (s) => importsTelegraf(s) || s.includes('../bot'),
    );
    expect(violations).toEqual([]);
  });

  it('the common layer imports neither SDK nor either feature side', () => {
    const violations = findViolations(
      join(LIB_DIR, 'common'),
      (s) =>
        importsGramJs(s) ||
        importsTelegraf(s) ||
        s.includes('../bot') ||
        s.includes('../client'),
    );
    expect(violations).toEqual([]);
  });
});
