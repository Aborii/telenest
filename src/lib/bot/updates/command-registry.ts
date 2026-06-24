/**
 * @file src/lib/bot/updates/command-registry.ts
 *
 * PURPOSE
 * -------
 * Pure (network-free) helpers that turn the command declarations harvested from
 * `@Command(name, { description })` bindings into validated, grouped
 * `setMyCommands` payloads. The registrar collects {@link DeclaredCommand}s from
 * the discovered handlers and calls {@link buildCommandGroups} to validate them
 * against Telegram's documented limits and split them into one Bot API call per
 * `scope`/`languageCode`.
 *
 * Keeping this logic here (rather than in the registrar) makes it trivially
 * unit-testable and keeps the registrar focused on discovery + binding. No
 * `telegram`/`telegraf` SDK import is needed — only the library's own derived
 * {@link BotCommand}/{@link BotCommandScope} types.
 *
 * USAGE
 * -----
 * Internal to `src/lib/bot/updates`. The registrar is the only caller.
 *
 * KEY EXPORTS
 * -----------
 * - DeclaredCommand: a single command harvested from a `@Command` binding.
 * - CommandRegistrationGroup: a validated, grouped `setMyCommands` payload.
 * - extractCommandNames: pulls plain string command names out of a trigger.
 * - buildCommandGroups: validates + groups declarations (throws on violations).
 * - TELEGRAM_COMMAND_NAME_PATTERN / MAX_*: the Telegram limits enforced.
 */

import { TelegramConfigError } from '../../common';
import type { BotCommand, BotCommandScope } from './telegram-update.types';

/**
 * Telegram's command-name rule: 1–32 characters, lowercase English letters,
 * digits, and underscores only (no leading slash). Mirrors the Bot API docs for
 * `BotCommand.command`.
 */
export const TELEGRAM_COMMAND_NAME_PATTERN = /^[a-z0-9_]{1,32}$/;

/** Telegram's maximum length for a `BotCommand.description` (1–256 characters). */
export const MAX_COMMAND_DESCRIPTION_LENGTH = 256;

/** Telegram's maximum number of commands per scope/language registration. */
export const MAX_COMMANDS_PER_SCOPE = 100;

/**
 * A single command declaration harvested from a `@Command(name, { description })`
 * binding, before validation. One declaration maps to one menu entry; an array
 * trigger expands to several declarations sharing a description/scope.
 */
export interface DeclaredCommand {
  /** The command name (no leading slash), e.g. `'ping'`. */
  readonly command: string;
  /** The human-readable description shown in the menu. */
  readonly description: string;
  /** Optional command-menu scope; omit for the default (all users). */
  readonly scope?: BotCommandScope;
  /** Optional two-letter language code the description applies to. */
  readonly languageCode?: string;
  /**
   * Where this command was declared (e.g. `GreeterUpdate.onPing`), used to make
   * validation error messages actionable. Not part of the Bot API payload.
   */
  readonly source: string;
}

/**
 * A validated `setMyCommands` payload for one `scope`/`languageCode` pair — the
 * registrar makes exactly one Bot API call per group.
 */
export interface CommandRegistrationGroup {
  /** The commands for this scope/language, in declaration order. */
  readonly commands: readonly BotCommand[];
  /** The scope these commands apply to, or `undefined` for the default scope. */
  readonly scope?: BotCommandScope;
  /** The language code these commands apply to, or `undefined` for the default. */
  readonly languageCode?: string;
}

/**
 * Extracts the plain string command names from a `@Command` trigger. A trigger
 * may be a single value or an array, and may contain `RegExp`/predicate entries
 * (valid for *handling* a command but meaningless as a *menu* entry); only
 * strings are returned. A leading slash, if present, is stripped so `'/ping'`
 * and `'ping'` normalise to the same menu name.
 *
 * @param trigger - The `@Command` trigger (string, RegExp, predicate, or array).
 * @returns The string command names found, with any leading slash removed.
 * @throws Never.
 */
export function extractCommandNames(trigger: unknown): string[] {
  const candidates = Array.isArray(trigger) ? trigger : [trigger];
  const names: string[] = [];
  for (const candidate of candidates) {
    if (typeof candidate !== 'string') continue;
    // ── Normalise a stray leading slash so '/ping' === 'ping'. ────────────────
    names.push(candidate.startsWith('/') ? candidate.slice(1) : candidate);
  }
  return names;
}

/**
 * Builds a stable map key for a `scope`/`languageCode` pair. The scope object's
 * keys are sorted before serialization so two semantically-identical scopes
 * written with different property order (e.g. `{ type, chat_id }` vs
 * `{ chat_id, type }`) hash to the same key and group together.
 *
 * @param scope - The command scope, or `undefined` for the default scope.
 * @param languageCode - The language code, or `undefined` for the default.
 * @returns A string key uniquely identifying the group.
 * @throws Never.
 */
function groupKey(scope?: BotCommandScope, languageCode?: string): string {
  // ── Canonicalize the scope into a sorted "key=value&…" string so it is
  //    order-insensitive. A scope is always a plain string-keyed object, so the
  //    via-`unknown` cast to a record is sound (the union has no index sig). ───
  const canonicalScope =
    scope === undefined
      ? null
      : Object.entries(scope as unknown as Record<string, unknown>)
          .sort(([a], [b]) => a.localeCompare(b))
          .map(([key, value]) => `${key}=${JSON.stringify(value)}`)
          .join('&');
  return JSON.stringify({
    scope: canonicalScope,
    languageCode: languageCode ?? null,
  });
}

/**
 * Validates command declarations against Telegram's limits and groups them by
 * `scope`/`languageCode` into ready-to-send `setMyCommands` payloads.
 *
 * Validation (all surfaced as {@link TelegramConfigError} so misconfiguration
 * fails fast at bootstrap rather than as an opaque Bot API rejection):
 * - the command name matches {@link TELEGRAM_COMMAND_NAME_PATTERN};
 * - the description is 1–{@link MAX_COMMAND_DESCRIPTION_LENGTH} characters;
 * - no two commands in the same group share a name;
 * - no group exceeds {@link MAX_COMMANDS_PER_SCOPE} commands.
 *
 * @param declared - The harvested command declarations (any order).
 * @returns One {@link CommandRegistrationGroup} per distinct scope/language,
 *   each carrying its `BotCommand[]` in declaration order. Empty when `declared`
 *   is empty.
 * @throws {TelegramConfigError} If any declaration violates a Telegram limit.
 *
 * @example
 * ```ts
 * const groups = buildCommandGroups([
 *   { command: 'ping', description: 'Ping', source: 'X.onPing' },
 * ]);
 * // → [{ commands: [{ command: 'ping', description: 'Ping' }] }]
 * ```
 */
export function buildCommandGroups(
  declared: readonly DeclaredCommand[],
): CommandRegistrationGroup[] {
  // ── Preserve first-seen group order so the output is deterministic. ─────────
  const groups = new Map<
    string,
    {
      scope?: BotCommandScope;
      languageCode?: string;
      commands: BotCommand[];
      seen: Set<string>;
    }
  >();

  for (const entry of declared) {
    // ── Per-command validation against Telegram's documented limits. ──────────
    if (!TELEGRAM_COMMAND_NAME_PATTERN.test(entry.command))
      throw new TelegramConfigError(
        `Invalid Telegram command name "${entry.command}" (from ${entry.source}): ` +
          'names must be 1-32 characters of lowercase letters, digits, or underscores.',
      );
    if (
      entry.description.length < 1 ||
      entry.description.length > MAX_COMMAND_DESCRIPTION_LENGTH
    )
      throw new TelegramConfigError(
        `Invalid description for command "${entry.command}" (from ${entry.source}): ` +
          `descriptions must be 1-${MAX_COMMAND_DESCRIPTION_LENGTH} characters.`,
      );

    const key = groupKey(entry.scope, entry.languageCode);
    let group = groups.get(key);
    if (!group) {
      group = {
        scope: entry.scope,
        languageCode: entry.languageCode,
        commands: [],
        seen: new Set<string>(),
      };
      groups.set(key, group);
    }

    // ── Telegram rejects duplicate names within one scope; catch it early. ────
    if (group.seen.has(entry.command))
      throw new TelegramConfigError(
        `Duplicate command "${entry.command}" (from ${entry.source}) within the ` +
          'same command scope/language; each command may be declared only once per scope.',
      );
    group.seen.add(entry.command);
    group.commands.push({
      command: entry.command,
      description: entry.description,
    });

    if (group.commands.length > MAX_COMMANDS_PER_SCOPE)
      throw new TelegramConfigError(
        `Too many commands for one scope (> ${MAX_COMMANDS_PER_SCOPE}); ` +
          'Telegram allows at most 100 commands per scope/language.',
      );
  }

  // ── Strip the internal `seen` set from the public group shape. ──────────────
  return [...groups.values()].map((group) => ({
    commands: group.commands,
    ...(group.scope !== undefined && { scope: group.scope }),
    ...(group.languageCode !== undefined && {
      languageCode: group.languageCode,
    }),
  }));
}
