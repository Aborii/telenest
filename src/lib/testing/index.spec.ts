/**
 * @file src/lib/testing/index.spec.ts
 *
 * PURPOSE
 * -------
 * Self-tests for the public testing utilities shipped in the
 * `nestjs-telegram/testing` subpath. Every exported function is exercised here
 * to guarantee the utilities work as documented and surface regressions.
 */

import { Test } from '@nestjs/testing';
import { TelegramUserService } from '../client/telegram-user.service';
import { aGramDialog, aGramMessage, aGramUser } from './dto-builders';
import { createMockBotContext } from './mock-bot-context';
import { createMockGramClient } from './mock-gram-client';
import { withMockGramClient } from './testing-module.helper';

// ── DTO builders ──────────────────────────────────────────────────────────────

describe('aGramUser', () => {
  it('returns a complete GramUser with defaults', () => {
    const user = aGramUser();
    expect(user.id).toBe('1001');
    expect(user.isSelf).toBe(false);
    expect(user.isBot).toBe(false);
    expect(user.isPremium).toBe(false);
    expect(user.firstName).toBe('Test');
    expect(user.username).toBe('testuser');
  });

  it('applies overrides correctly', () => {
    const user = aGramUser({ id: '9999', username: 'bot', isBot: true, isSelf: true });
    expect(user.id).toBe('9999');
    expect(user.username).toBe('bot');
    expect(user.isBot).toBe(true);
    expect(user.isSelf).toBe(true);
    // Unoverridden fields keep their defaults.
    expect(user.isPremium).toBe(false);
  });

  it('merges optional fields', () => {
    const user = aGramUser({ phone: '+15551234', lastName: 'Doe' });
    expect(user.phone).toBe('+15551234');
    expect(user.lastName).toBe('Doe');
  });
});

describe('aGramMessage', () => {
  it('returns a complete GramMessage with defaults', () => {
    const msg = aGramMessage();
    expect(msg.id).toBe(1);
    expect(msg.peerId).toBe('1001');
    expect(msg.text).toBe('Hello');
    expect(msg.date).toBe(1700000000);
    expect(msg.out).toBe(false);
  });

  it('applies overrides correctly', () => {
    const msg = aGramMessage({ text: 'World', out: true, id: 42 });
    expect(msg.text).toBe('World');
    expect(msg.out).toBe(true);
    expect(msg.id).toBe(42);
    // Unoverridden fields keep their defaults.
    expect(msg.peerId).toBe('1001');
  });

  it('supports optional senderId override', () => {
    const msg = aGramMessage({ senderId: '5555' });
    expect(msg.senderId).toBe('5555');
  });
});

describe('aGramDialog', () => {
  it('returns a complete GramDialog with defaults', () => {
    const dialog = aGramDialog();
    expect(dialog.id).toBe('2001');
    expect(dialog.title).toBe('Test Chat');
    expect(dialog.type).toBe('user');
    expect(dialog.unreadCount).toBe(0);
    expect(dialog.pinned).toBe(false);
  });

  it('applies overrides correctly', () => {
    const dialog = aGramDialog({ type: 'channel', title: 'News', unreadCount: 7 });
    expect(dialog.type).toBe('channel');
    expect(dialog.title).toBe('News');
    expect(dialog.unreadCount).toBe(7);
    // Unoverridden fields keep their defaults.
    expect(dialog.pinned).toBe(false);
  });
});

// ── createMockGramClient ───────────────────────────────────────────────────────

describe('createMockGramClient', () => {
  it('returns a jest.Mocked<IGramClient> with all methods as jest.fn()', () => {
    const client = createMockGramClient();
    // Every method should be a jest mock function.
    expect(typeof client.connect).toBe('function');
    expect(typeof client.disconnect).toBe('function');
    expect(typeof client.getMe).toBe('function');
    expect(typeof client.getDialogs).toBe('function');
    expect(typeof client.getMessages).toBe('function');
    expect(typeof client.sendMessage).toBe('function');
    expect(typeof client.sendCode).toBe('function');
    expect(typeof client.signInWithCode).toBe('function');
    expect(typeof client.signInWithPassword).toBe('function');
    expect(typeof client.logOut).toBe('function');
    expect(typeof client.exportSession).toBe('function');
    expect(typeof client.onNewMessage).toBe('function');
  });

  it('isConnected returns true by default', () => {
    expect(createMockGramClient().isConnected()).toBe(true);
  });

  it('isAuthorized resolves true by default', async () => {
    await expect(createMockGramClient().isAuthorized()).resolves.toBe(true);
  });

  it('connect resolves undefined by default', async () => {
    await expect(createMockGramClient().connect()).resolves.toBeUndefined();
  });

  it('getMe resolves with aGramUser() defaults', async () => {
    const me = await createMockGramClient().getMe();
    expect(me.id).toBe('1001');
    expect(me.isBot).toBe(false);
  });

  it('getDialogs resolves with empty array by default', async () => {
    await expect(createMockGramClient().getDialogs()).resolves.toEqual([]);
  });

  it('getMessages resolves with empty array by default', async () => {
    await expect(createMockGramClient().getMessages('me')).resolves.toEqual([]);
  });

  it('sendCode resolves with a mock hash by default', async () => {
    const result = await createMockGramClient().sendCode('+1555');
    expect(result.phoneCodeHash).toBe('MOCK_HASH');
    expect(result.isCodeViaApp).toBe(true);
  });

  it('signInWithCode resolves with authorized status by default', async () => {
    const result = await createMockGramClient().signInWithCode({
      phoneNumber: '+1',
      phoneCodeHash: 'H',
      phoneCode: '1',
    });
    expect(result.status).toBe('authorized');
  });

  it('exportSession returns empty string by default', () => {
    expect(createMockGramClient().exportSession()).toBe('');
  });

  it('onNewMessage returns an unsubscribe function by default', () => {
    const unsub = createMockGramClient().onNewMessage(() => undefined);
    expect(typeof unsub).toBe('function');
  });

  it('applies overrides correctly', async () => {
    const customUser = aGramUser({ username: 'override_bot' });
    const client = createMockGramClient({
      getMe: jest.fn().mockResolvedValue(customUser),
    });
    const me = await client.getMe();
    expect(me.username).toBe('override_bot');
  });

  it('works as an IGramClient injected into TelegramUserService', async () => {
    const client = createMockGramClient();
    const service = new TelegramUserService(client);
    await service.getMe();
    expect(client.getMe).toHaveBeenCalledTimes(1);
  });
});

// ── createMockBotContext ───────────────────────────────────────────────────────

describe('createMockBotContext', () => {
  it('returns an object with reply as a jest.fn()', () => {
    const ctx = createMockBotContext();
    expect(typeof ctx.reply).toBe('function');
    // Jest mock functions expose `.mock` property.
    expect((ctx.reply as jest.Mock).mock).toBeDefined();
  });

  it('reply resolves by default (does not throw)', async () => {
    const ctx = createMockBotContext();
    await expect(ctx.reply('hello')).resolves.toBeDefined();
  });

  it('records calls on reply', async () => {
    const ctx = createMockBotContext();
    await ctx.reply('test message');
    expect(ctx.reply).toHaveBeenCalledWith('test message');
  });

  it('exposes the update field', () => {
    const ctx = createMockBotContext({ update: { update_id: 42 } });
    expect(ctx.update.update_id).toBe(42);
  });

  it('merges extra fields from overrides onto the context', () => {
    const ctx = createMockBotContext({ myCustomField: 'hello' });
    // Access via index signature (the extra field is merged at runtime).
    expect((ctx as unknown as Record<string, unknown>)['myCustomField']).toBe('hello');
  });

  it('stubs answerCbQuery to resolve true', async () => {
    const ctx = createMockBotContext();
    await expect(ctx.answerCbQuery()).resolves.toBe(true);
  });

  it('stubs deleteMessage', async () => {
    const ctx = createMockBotContext();
    await ctx.deleteMessage();
    expect(ctx.deleteMessage).toHaveBeenCalled();
  });

  it('state is an empty object by default', () => {
    const ctx = createMockBotContext();
    expect(ctx.state).toEqual({});
  });

  it('botInfo exposes expected fields', () => {
    const ctx = createMockBotContext();
    expect(ctx.botInfo.is_bot).toBe(true);
    expect(ctx.botInfo.username).toBe('test_bot');
  });
});

// ── withMockGramClient ────────────────────────────────────────────────────────

describe('withMockGramClient', () => {
  it('returns a provider whose factory returns the supplied client', () => {
    const client = createMockGramClient();
    const provider = withMockGramClient(client);
    expect(provider.provide).toBeDefined();
    expect(provider.useFactory()).toBe(client);
  });

  it('wires TelegramUserService in a TestingModule via withMockGramClient', async () => {
    const client = createMockGramClient({
      getMe: jest.fn().mockResolvedValue(aGramUser({ username: 'di_user' })),
    });

    const moduleRef = await Test.createTestingModule({
      providers: [TelegramUserService, withMockGramClient(client)],
    }).compile();

    const userService = moduleRef.get(TelegramUserService);
    const me = await userService.getMe();
    expect(me.username).toBe('di_user');
    expect(client.getMe).toHaveBeenCalledTimes(1);
  });
});
