/**
 * @file src/lib/client/telegram-client.multi-account.spec.ts
 *
 * PURPOSE
 * -------
 * Integration tests for running multiple named MTProto user accounts in one
 * application. They prove the issue's acceptance criteria end-to-end: two accounts
 * register and inject independently without token/session collisions;
 * `@OnUserMessage(filter, { client })` dispatches only to the named account (and
 * replies through it); the default account coexists with named accounts without
 * leaking handlers; `@InjectTelegramUser` / `@InjectTelegramAuth` resolve per
 * account; and each account persists its session to its own store.
 *
 * No network is touched: each account is given a fake {@link IGramClient} via the
 * `clientFactory` seam with `autoConnect: false`, and the inbound stream is driven
 * by invoking the fake's captured `onNewMessage` callback.
 */

import { type DynamicModule, Injectable, type Provider } from '@nestjs/common';
import { Test, type TestingModule } from '@nestjs/testing';

import type { IGramClient } from './gram-client.interface';
import type { GramMessage } from './gram-client.types';
import type { SessionStore } from './session/session-store.interface';
import { TelegramAuthService } from './telegram-auth.service';
import { TelegramClientModule } from './telegram-client.module';
import {
  getGramClientToken,
  getTelegramAuthToken,
  getTelegramUserToken,
  InjectTelegramAuth,
  InjectTelegramUser,
} from './telegram-client.tokens';
import { TelegramUserService } from './telegram-user.service';
import { OnUserMessage } from './updates/on-user-message.decorator';

/** A fake account: its client, a captured inbound-message emitter, its store. */
interface FakeAccount {
  client: IGramClient;
  emit: (message: GramMessage) => void;
  store: SessionStore;
}

/** Builds a no-network fake account whose inbound stream the test can drive. */
function createFakeAccount(session = 'SESSION'): FakeAccount {
  let onMessage: ((message: GramMessage) => void) | undefined;
  const store: SessionStore = {
    load: jest.fn().mockResolvedValue(undefined),
    save: jest.fn().mockResolvedValue(undefined),
    clear: jest.fn().mockResolvedValue(undefined),
  };
  const client: IGramClient = {
    connect: jest.fn().mockResolvedValue(undefined),
    disconnect: jest.fn().mockResolvedValue(undefined),
    isConnected: jest.fn().mockReturnValue(true),
    isAuthorized: jest.fn().mockResolvedValue(true),
    sendCode: jest.fn().mockResolvedValue({ phoneCodeHash: 'HASH' }),
    signInWithCode: jest
      .fn()
      .mockResolvedValue({ status: 'authorized', user: { id: '1' } }),
    signInWithPassword: jest.fn(),
    logOut: jest.fn().mockResolvedValue(undefined),
    getMe: jest.fn().mockResolvedValue({ id: '1', isSelf: true }),
    getDialogs: jest.fn().mockResolvedValue([]),
    getMessages: jest.fn().mockResolvedValue([]),
    sendMessage: jest.fn().mockResolvedValue({}),
    exportSession: jest.fn().mockReturnValue(session),
    onNewMessage: (handler) => {
      onMessage = handler;
      return () => {
        onMessage = undefined;
      };
    },
  };
  return { client, store, emit: (message) => onMessage?.(message) };
}

/** A minimal inbound message. */
const message = (id: number): GramMessage => ({
  id,
  peerId: '1',
  text: 'hi',
  date: 0,
  out: false,
});

/** Flushes pending microtasks (the registrar invokes handlers asynchronously). */
const flush = (): Promise<void> =>
  new Promise((resolve) => setImmediate(resolve));

/** A handler scoped to the `personal` account. */
@Injectable()
class PersonalHandler {
  public readonly seen: GramMessage[] = [];
  @OnUserMessage({}, { client: 'personal' })
  public onMessage(msg: GramMessage): void {
    this.seen.push(msg);
  }
}

/** A handler scoped to the `ops` account. */
@Injectable()
class OpsHandler {
  public readonly seen: GramMessage[] = [];
  @OnUserMessage({}, { client: 'ops' })
  public onMessage(msg: GramMessage): void {
    this.seen.push(msg);
  }
}

/** A handler on the default account (no `client` option). */
@Injectable()
class DefaultHandler {
  public readonly seen: GramMessage[] = [];
  @OnUserMessage()
  public onMessage(msg: GramMessage): void {
    this.seen.push(msg);
  }
}

/** A consumer injecting two accounts' services by name. */
@Injectable()
class AccountConsumer {
  public constructor(
    @InjectTelegramUser('personal')
    public readonly personalUser: TelegramUserService,
    @InjectTelegramAuth('ops') public readonly opsAuth: TelegramAuthService,
  ) {}
}

/** Registers an account with a fake client (and optional store) — no network. */
function account(name: string | undefined, fake: FakeAccount): DynamicModule {
  return TelegramClientModule.forRoot({
    ...(name ? { name } : {}),
    apiId: 1,
    apiHash: 'hash',
    autoConnect: false,
    clientFactory: () => fake.client,
    sessionStore: fake.store,
  });
}

/** Compiles a testing module from the given imports/providers. */
async function compile(
  imports: DynamicModule[],
  providers: Provider[] = [],
): Promise<TestingModule> {
  return Test.createTestingModule({ imports, providers }).compile();
}

describe('TelegramClientModule — multiple named accounts', () => {
  it('wires isolated services bound to each account’s own client', async () => {
    const personal = createFakeAccount();
    const ops = createFakeAccount();

    const moduleRef = await compile([
      account('personal', personal),
      account('ops', ops),
    ]);

    const personalUser = moduleRef.get<TelegramUserService>(
      getTelegramUserToken('personal'),
      { strict: false },
    );
    const opsUser = moduleRef.get<TelegramUserService>(
      getTelegramUserToken('ops'),
      { strict: false },
    );

    expect(personalUser).toBeInstanceOf(TelegramUserService);
    expect(opsUser).toBeInstanceOf(TelegramUserService);
    expect(personalUser).not.toBe(opsUser);
    // ── Each account's raw client token resolves its own fake. ────────────────
    expect(
      moduleRef.get<IGramClient>(getGramClientToken('personal'), {
        strict: false,
      }),
    ).toBe(personal.client);
    expect(
      moduleRef.get<IGramClient>(getGramClientToken('ops'), { strict: false }),
    ).toBe(ops.client);
  });

  it('routes @OnUserMessage to the matching account only', async () => {
    const personal = createFakeAccount();
    const ops = createFakeAccount();

    const moduleRef = await compile(
      [account('personal', personal), account('ops', ops)],
      [PersonalHandler, OpsHandler],
    );
    // ── Real lifecycle wires each account's user service + registrar. ─────────
    await moduleRef.init();

    personal.emit(message(1));
    ops.emit(message(2));
    await flush();

    expect(moduleRef.get(PersonalHandler).seen.map((m) => m.id)).toEqual([1]);
    expect(moduleRef.get(OpsHandler).seen.map((m) => m.id)).toEqual([2]);

    await moduleRef.close();
  });

  it('keeps the default account’s handlers off a named account', async () => {
    const def = createFakeAccount();
    const ops = createFakeAccount();

    const moduleRef = await compile(
      [account(undefined, def), account('ops', ops)],
      [DefaultHandler, OpsHandler],
    );
    await moduleRef.init();

    def.emit(message(1));
    await flush();
    expect(moduleRef.get(DefaultHandler).seen.map((m) => m.id)).toEqual([1]);
    expect(moduleRef.get(OpsHandler).seen).toHaveLength(0);

    ops.emit(message(2));
    await flush();
    expect(moduleRef.get(OpsHandler).seen.map((m) => m.id)).toEqual([2]);
    // ── The default handler never saw the ops account's message. ──────────────
    expect(moduleRef.get(DefaultHandler).seen).toHaveLength(1);

    await moduleRef.close();
  });

  it('@InjectTelegramUser / @InjectTelegramAuth resolve each account’s service', async () => {
    const personal = createFakeAccount();
    const ops = createFakeAccount();

    const moduleRef = await compile(
      [account('personal', personal), account('ops', ops)],
      [AccountConsumer],
    );

    const consumer = moduleRef.get(AccountConsumer);
    expect(consumer.personalUser).toBeInstanceOf(TelegramUserService);
    expect(consumer.opsAuth).toBeInstanceOf(TelegramAuthService);
    expect(consumer.personalUser).toBe(
      moduleRef.get<TelegramUserService>(getTelegramUserToken('personal'), {
        strict: false,
      }),
    );
  });

  it('registers a named account via forRootAsync', async () => {
    const reports = createFakeAccount();

    const moduleRef = await compile([
      TelegramClientModule.forRootAsync({
        name: 'reports',
        useFactory: () => ({
          apiId: 1,
          apiHash: 'hash',
          autoConnect: false,
          clientFactory: () => reports.client,
        }),
      }),
    ]);

    const user = moduleRef.get<TelegramUserService>(
      getTelegramUserToken('reports'),
      { strict: false },
    );
    expect(user).toBeInstanceOf(TelegramUserService);
    expect(
      moduleRef.get<IGramClient>(getGramClientToken('reports'), {
        strict: false,
      }),
    ).toBe(reports.client);
  });

  it('persists each account’s session to its own store', async () => {
    const personal = createFakeAccount('PERSONAL-SESSION');
    const ops = createFakeAccount('OPS-SESSION');

    const moduleRef = await compile([
      account('personal', personal),
      account('ops', ops),
    ]);

    const personalAuth = moduleRef.get<TelegramAuthService>(
      getTelegramAuthToken('personal'),
      { strict: false },
    );

    // ── Sign in the personal account; only its own store must be written. ─────
    await personalAuth.sendCode('+15551234567');
    await personalAuth.signIn('12345');

    expect(personal.store.save).toHaveBeenCalledWith('PERSONAL-SESSION');
    expect(ops.store.save).not.toHaveBeenCalled();
  });
});
