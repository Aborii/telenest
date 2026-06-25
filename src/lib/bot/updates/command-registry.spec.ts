/**
 * @file src/lib/bot/updates/command-registry.spec.ts
 *
 * PURPOSE
 * -------
 * Unit tests for the pure command-menu helpers: name extraction from triggers,
 * and validation + grouping of declared commands into `setMyCommands` payloads.
 * Covers every Telegram limit enforced (name regex, description length, per-scope
 * count, duplicates) and the scope/language grouping behaviour. No network.
 */

import { TelegramConfigError } from '../../common';
import {
  buildCommandGroups,
  extractCommandNames,
  MAX_COMMANDS_PER_SCOPE,
  type DeclaredCommand,
} from './command-registry';
import type { BotCommandScope } from './telegram-update.types';

/** Builds a minimal valid declaration, overridable per test. */
function declare(overrides: Partial<DeclaredCommand> = {}): DeclaredCommand {
  return {
    command: 'ping',
    description: 'Ping the bot',
    source: 'Test.handler',
    ...overrides,
  };
}

describe('extractCommandNames', () => {
  it('returns a single string trigger', () => {
    expect(extractCommandNames('ping')).toEqual(['ping']);
  });

  it('returns every string in an array trigger', () => {
    expect(extractCommandNames(['ping', 'pong'])).toEqual(['ping', 'pong']);
  });

  it('strips a leading slash so /ping === ping', () => {
    expect(extractCommandNames('/ping')).toEqual(['ping']);
    expect(extractCommandNames(['/a', 'b'])).toEqual(['a', 'b']);
  });

  it('skips non-string entries (RegExp / predicate)', () => {
    const predicate = (): boolean => true;
    expect(extractCommandNames(/ping/)).toEqual([]);
    expect(extractCommandNames(predicate)).toEqual([]);
    expect(extractCommandNames(['ping', /x/, predicate])).toEqual(['ping']);
  });

  it('strips a trailing @botusername so /ping@MyBot === ping', () => {
    expect(extractCommandNames('ping@MyBot')).toEqual(['ping']);
    expect(extractCommandNames('/ping@MyBot')).toEqual(['ping']);
    expect(extractCommandNames(['help@Bot', 'stop'])).toEqual(['help', 'stop']);
  });

  it('omits a trigger that is only an @botusername', () => {
    expect(extractCommandNames('@MyBot')).toEqual([]);
  });
});

describe('buildCommandGroups', () => {
  it('returns an empty array for no declarations', () => {
    expect(buildCommandGroups([])).toEqual([]);
  });

  it('builds a single default-scope group preserving order', () => {
    const groups = buildCommandGroups([
      declare({ command: 'ping', description: 'P' }),
      declare({ command: 'help', description: 'H' }),
    ]);

    expect(groups).toEqual([
      {
        commands: [
          { command: 'ping', description: 'P' },
          { command: 'help', description: 'H' },
        ],
      },
    ]);
    // ── Default scope means no scope/languageCode keys at all. ────────────────
    expect(groups[0]).not.toHaveProperty('scope');
    expect(groups[0]).not.toHaveProperty('languageCode');
  });

  it('splits distinct scopes / languages into separate groups', () => {
    const privateScope: BotCommandScope = { type: 'all_private_chats' };
    const groups = buildCommandGroups([
      declare({ command: 'ping' }),
      declare({ command: 'admin', scope: privateScope }),
      declare({ command: 'hola', languageCode: 'es' }),
    ]);

    expect(groups).toHaveLength(3);
    expect(groups[1]).toMatchObject({
      scope: privateScope,
      commands: [{ command: 'admin', description: 'Ping the bot' }],
    });
    expect(groups[2]).toMatchObject({
      languageCode: 'es',
      commands: [{ command: 'hola', description: 'Ping the bot' }],
    });
  });

  it('groups commands sharing the same scope together', () => {
    const scope: BotCommandScope = { type: 'all_group_chats' };
    const groups = buildCommandGroups([
      declare({ command: 'a', scope }),
      declare({ command: 'b', scope }),
    ]);

    expect(groups).toHaveLength(1);
    expect(groups[0]?.commands).toHaveLength(2);
  });

  it('groups identical scopes regardless of property order', () => {
    // ── Same scope, keys written in two different orders → one group. ─────────
    const a = { type: 'chat', chat_id: 5 } as unknown as BotCommandScope;
    const b = { chat_id: 5, type: 'chat' } as unknown as BotCommandScope;
    const groups = buildCommandGroups([
      declare({ command: 'one', scope: a }),
      declare({ command: 'two', scope: b }),
    ]);

    expect(groups).toHaveLength(1);
    expect(groups[0]?.commands).toHaveLength(2);
  });

  it.each([
    ['UPPER', 'uppercase letters'],
    ['has space', 'a space'],
    ['dash-no', 'a dash'],
    ['', 'empty'],
    ['a'.repeat(33), 'over 32 chars'],
  ])('rejects invalid command name %p (%s)', (command) => {
    expect(() => buildCommandGroups([declare({ command })])).toThrow(
      TelegramConfigError,
    );
  });

  it('accepts a 32-char name of letters, digits, underscores', () => {
    const command = `a_${'0'.repeat(30)}`; // 32 chars
    expect(command).toHaveLength(32);
    expect(() => buildCommandGroups([declare({ command })])).not.toThrow();
  });

  it('rejects an empty description', () => {
    expect(() =>
      buildCommandGroups([declare({ description: '' })]),
    ).toThrow(TelegramConfigError);
  });

  it('rejects a description longer than 256 characters', () => {
    expect(() =>
      buildCommandGroups([declare({ description: 'x'.repeat(257) })]),
    ).toThrow(/1-256 characters/);
  });

  it('rejects a duplicate command within the same scope', () => {
    expect(() =>
      buildCommandGroups([declare({ command: 'ping' }), declare({ command: 'ping' })]),
    ).toThrow(/Duplicate command/);
  });

  it('allows the same name under different scopes', () => {
    const groups = buildCommandGroups([
      declare({ command: 'ping' }),
      declare({ command: 'ping', scope: { type: 'all_private_chats' } }),
    ]);
    expect(groups).toHaveLength(2);
  });

  it(`rejects more than ${MAX_COMMANDS_PER_SCOPE} commands in one scope`, () => {
    const tooMany = Array.from(
      { length: MAX_COMMANDS_PER_SCOPE + 1 },
      (_unused, i) => declare({ command: `cmd_${i}` }),
    );
    expect(() => buildCommandGroups(tooMany)).toThrow(/Too many commands/);
  });

  it(`allows exactly ${MAX_COMMANDS_PER_SCOPE} commands in one scope`, () => {
    const exactly = Array.from(
      { length: MAX_COMMANDS_PER_SCOPE },
      (_unused, i) => declare({ command: `cmd_${i}` }),
    );
    expect(buildCommandGroups(exactly)[0]?.commands).toHaveLength(
      MAX_COMMANDS_PER_SCOPE,
    );
  });
});
