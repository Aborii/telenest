#!/usr/bin/env node

/**
 * @file Interactive release script.
 *
 * PURPOSE
 * Cut a versioned release end-to-end: bump the version, merge `dev` into
 * `main`, tag it, and publish a GitHub release — replacing the error-prone
 * manual sequence with a guided, repeatable flow. This mirrors the `dev`→`main`
 * release flow documented in the project `CLAUDE.md` (releases are GitHub-only,
 * never npm, and the repo stays private).
 *
 * USAGE
 * npm run git:release            # interactive
 * npm run git:release -- --dry-run  # print every action without changing anything
 *
 * ENVIRONMENT VARIABLES
 * RELEASE_DEV_BRANCH  Source branch to release from (default "dev").
 * RELEASE_MAIN_BRANCH Release/target branch (default "main").
 * HUSKY               Set to "0" internally for the release git commits so any
 *                     repo hooks do not run during the release.
 *
 * STEPS EXECUTED
 * 1. Preflight: gh auth, clean working tree, fetch, ensure the source branch
 *    is in sync with its remote.
 * 2. Prompt for the version bump (patch / minor / major / custom).
 * 3. Bump package.json on the source branch, commit, and push it.
 * 4. Gate on `npm run typecheck` (and optionally `npm test`).
 * 5. Merge source -> target (--no-ff) and push the target branch.
 * 6. Create an annotated tag and a GitHub release with generated notes.
 *
 * SAFETY GUARDS
 * - Aborts on a dirty working tree, unauthenticated gh, missing branches, a
 *   diverged source branch, or an already-existing tag.
 * - The release commits run with HUSKY=0 so any git hooks never interfere;
 *   typecheck is run explicitly as the gate instead.
 * - A merge conflict between source and target is aborted (`git merge
 *   --abort`), the source branch is restored, and the script exits without
 *   pushing — conflicts must be resolved manually.
 * - `--dry-run` performs every read-only check but skips all mutations.
 *
 * NOTE
 * This is an `.mts` (ESM TypeScript) file on purpose: this package is CommonJS
 * (no `"type": "module"` in package.json), so a plain `.ts` here would be
 * treated as CommonJS and could not import the ESM-only `@clack/prompts`.
 * `.mts` keeps it ESM while still being type-checked. Run directly with `node`
 * (Node >= 23.6 strips the TypeScript types natively — no `tsx`/build step).
 */

import { execSync } from 'node:child_process';
import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import * as p from '@clack/prompts';

/** Repository root (this file lives in `<root>/scripts`). */
const ROOT: string = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const PKG_PATH: string = resolve(ROOT, 'package.json');
const DEV: string = process.env.RELEASE_DEV_BRANCH || 'dev';
const MAIN: string = process.env.RELEASE_MAIN_BRANCH || 'main';
const DRY: boolean = process.argv.includes('--dry-run');

/** The semver components this script knows how to bump (excludes "custom"). */
type BumpKind = 'patch' | 'minor' | 'major';

/** Capture stdout of a command (trimmed). Throws on non-zero exit. */
function cap(cmd: string): string {
  return execSync(cmd, {
    cwd: ROOT,
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
  }).trim();
}

/** Run a mutating command (inherits stdio). Skipped & logged under --dry-run. */
function run(cmd: string, opts: { env?: Record<string, string> } = {}): void {
  if (DRY) {
    p.log.info(`[dry-run] ${cmd}`);
    return;
  }
  execSync(cmd, {
    cwd: ROOT,
    stdio: 'inherit',
    env: { ...process.env, ...opts.env },
  });
}

/** Environment overlay that disables husky hooks for a single git command. */
const NO_HOOKS: Record<string, string> = { HUSKY: '0' };

/** Print a cancellation message and exit with a non-zero status. */
function fail(message: string): never {
  p.cancel(message);
  process.exit(1);
}

/** Render the stdout/stderr captured on a thrown execSync error. */
function dumpError(err: unknown): void {
  const e = err as { stdout?: unknown; stderr?: unknown };
  process.stdout.write(String(e?.stdout ?? '') + String(e?.stderr ?? ''));
}

/** Bump an x.y.z version. Drops any prerelease suffix from the base. */
function bump(version: string, kind: BumpKind): string {
  const m = /^(\d+)\.(\d+)\.(\d+)/.exec(version);
  if (!m) fail(`Cannot parse current version "${version}" as semver.`);
  let [major, minor, patch] = m.slice(1).map(Number) as [
    number,
    number,
    number,
  ];
  if (kind === 'major') (major += 1), (minor = 0), (patch = 0);
  else if (kind === 'minor') (minor += 1), (patch = 0);
  else patch += 1;
  return `${major}.${minor}.${patch}`;
}

async function main(): Promise<void> {
  p.intro(`release${DRY ? ' (dry-run)' : ''}`);

  // ── Preflight ──────────────────────────────────────────────────────────

  const pkgRaw: string = readFileSync(PKG_PATH, 'utf8');
  const pkg = JSON.parse(pkgRaw) as { name: string; version: string };
  const current: string = pkg.version;
  const name: string = pkg.name;

  try {
    cap('gh auth status');
  } catch {
    fail('GitHub CLI is not authenticated. Run `gh auth login` first.');
  }

  let remote: string;
  try {
    remote = cap('git remote get-url origin');
  } catch {
    fail('No `origin` remote found.');
  }

  if (cap('git status --porcelain')) {
    fail('Working tree is not clean. Commit or stash your changes first.');
  }

  const sp = p.spinner();
  sp.start('Fetching from origin');
  cap('git fetch --prune --tags origin');
  sp.stop('Fetched origin');

  try {
    cap(`git rev-parse --verify origin/${DEV}`);
  } catch {
    fail(`origin/${DEV} not found.`);
  }

  try {
    cap(`git rev-parse --verify origin/${MAIN}`);
  } catch {
    fail(`origin/${MAIN} not found.`);
  }

  const branch: string = cap('git rev-parse --abbrev-ref HEAD');
  if (branch !== DEV) {
    const ok = await p.confirm({
      message: `You are on "${branch}". Switch to "${DEV}" to release?`,
    });
    if (p.isCancel(ok) || !ok) fail('Aborted.');
    run(`git checkout ${DEV}`);
  }

  // dev vs origin/dev: ahead<TAB>behind
  const [ahead, behind] = cap(
    `git rev-list --left-right --count ${DEV}...origin/${DEV}`,
  )
    .split(/\s+/)
    .map(Number) as [number, number];

  if (behind > 0 && ahead === 0) {
    run(`git merge --ff-only origin/${DEV}`);
  } else if (ahead > 0 && behind === 0) {
    const ok = await p.confirm({
      message: `Local ${DEV} has ${ahead} unpushed commit(s). Push them as part of this release?`,
    });
    if (p.isCancel(ok) || !ok)
      fail('Aborted — push or reset your local commits first.');
    run(`git push origin ${DEV}`, { env: NO_HOOKS });
  } else if (ahead > 0 && behind > 0) {
    fail(
      `Local ${DEV} and origin/${DEV} have diverged (ahead ${ahead}, behind ${behind}). Reconcile manually first.`,
    );
  }

  // ── Choose the version ─────────────────────────────────────────────────

  const choice = await p.select({
    message: `Current version is ${current}. How should it be bumped?`,
    options: [
      { value: 'patch', label: `patch → ${bump(current, 'patch')}` },
      { value: 'minor', label: `minor → ${bump(current, 'minor')}` },
      { value: 'major', label: `major → ${bump(current, 'major')}` },
      { value: 'custom', label: 'custom…' },
    ],
  });

  if (p.isCancel(choice)) fail('Aborted.');

  let next: string;
  if (choice === 'custom') {
    const entered = await p.text({
      message: 'Enter the new version (x.y.z):',
      validate: (v) =>
        /^\d+\.\d+\.\d+(-[0-9A-Za-z.-]+)?$/.test((v ?? '').trim())
          ? undefined
          : 'Must be a valid semver like 1.2.3',
    });
    if (p.isCancel(entered)) fail('Aborted.');
    next = entered.trim();
  } else {
    next = bump(current, choice as BumpKind);
  }

  const tag = `v${next}`;

  // Reject an existing tag (local or remote).
  let localTag = '';
  try {
    localTag = cap(`git rev-parse --verify --quiet refs/tags/${tag}`);
  } catch {
    /* not present locally — good */
  }

  const remoteTag = cap(`git ls-remote --tags origin ${tag}`);
  if (localTag || remoteTag) {
    fail(`Tag ${tag} already exists. Pick a different version.`);
  }

  // ── Confirm ────────────────────────────────────────────────────────────

  p.note(
    [
      `repo     ${name}`,
      `remote   ${remote}`,
      `version  ${current} → ${next}`,
      `branches ${DEV} → ${MAIN} (merge --no-ff)`,
      `tag      ${tag}`,
      `release  GitHub release with generated notes`,
    ].join('\n'),
    'Release plan',
  );

  const go = await p.confirm({
    message: DRY ? 'Run dry-run?' : 'Cut this release?',
  });

  if (p.isCancel(go) || !go) fail('Aborted.');

  // ── Gate: typecheck (always) + tests (optional) ────────────────────────

  const ts = p.spinner();
  ts.start('Running typecheck');
  try {
    cap('npm run typecheck');
    ts.stop('Typecheck passed');
  } catch (e) {
    ts.stop('Typecheck failed');
    dumpError(e);
    fail('Fix typecheck errors before releasing.');
  }

  const wantTests = await p.confirm({
    message: 'Run the test suite too? (slower)',
    initialValue: false,
  });

  if (!p.isCancel(wantTests) && wantTests) {
    const tt = p.spinner();
    tt.start('Running tests');
    try {
      cap('npm test');
      tt.stop('Tests passed');
    } catch (e) {
      tt.stop('Tests failed');
      dumpError(e);
      const cont = await p.confirm({
        message: 'Tests failed. Continue with the release anyway?',
        initialValue: false,
      });
      if (p.isCancel(cont) || !cont) fail('Aborted.');
    }
  }

  // ── Bump + commit on dev ───────────────────────────────────────────────

  // Targeted replace keeps the package.json diff to a single line.
  const updated = pkgRaw.replace(/("version"\s*:\s*")[^"]+(")/, `$1${next}$2`);
  if (updated === pkgRaw)
    fail('Could not locate the "version" field in package.json.');

  if (DRY) {
    p.log.info(`[dry-run] write package.json version → ${next}`);
  } else {
    writeFileSync(PKG_PATH, updated);
  }

  run(`git commit -am "chore(release): ${tag}"`, { env: NO_HOOKS });
  run(`git push origin ${DEV}`, { env: NO_HOOKS });

  // ── Merge dev → main ───────────────────────────────────────────────────

  run(`git checkout ${MAIN}`);
  try {
    run(`git merge --ff-only origin/${MAIN}`, { env: NO_HOOKS });
  } catch {
    run(`git checkout ${DEV}`);
    fail(
      `Local ${MAIN} has diverged from origin/${MAIN}. Reconcile it manually, then re-run.`,
    );
  }

  try {
    run(`git merge --no-ff -m "chore(release): ${tag}" ${DEV}`, {
      env: NO_HOOKS,
    });
  } catch {
    if (!DRY) {
      try {
        execSync('git merge --abort', { cwd: ROOT, stdio: 'ignore' });
      } catch {
        /* nothing to abort */
      }
    }
    run(`git checkout ${DEV}`);
    fail(
      `Merge conflicts between ${DEV} and ${MAIN}. Resolve them manually, then re-run.`,
    );
  }

  run(`git push origin ${MAIN}`, { env: NO_HOOKS });

  // ── Tag + GitHub release ───────────────────────────────────────────────

  run(`git tag -a ${tag} -m "Release ${tag}"`, { env: NO_HOOKS });
  run(`git push origin ${tag}`, { env: NO_HOOKS });

  let url = '';
  if (DRY) {
    p.log.info(
      `[dry-run] gh release create ${tag} --target ${MAIN} --title "${tag}" --generate-notes`,
    );
  } else {
    url = cap(
      `gh release create ${tag} --target ${MAIN} --title "${tag}" --generate-notes`,
    );
  }

  run(`git checkout ${DEV}`);

  p.outro(
    DRY
      ? `Dry-run complete — nothing was changed. Would have released ${tag}.`
      : `Released ${tag} 🎉 ${url}`,
  );
}

main().catch((err: unknown) => {
  p.log.error(String((err as Error)?.stack ?? err));
  process.exit(1);
});
