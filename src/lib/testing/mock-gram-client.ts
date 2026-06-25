/**
 * @file src/lib/testing/mock-gram-client.ts
 *
 * PURPOSE
 * -------
 * Public test seam for the MTProto (user-account) side. Promotes the
 * `jest.Mocked<IGramClient>` factory the library uses in its own specs into a
 * supported utility, plus a one-liner that registers the fake under the
 * {@link TELEGRAM_GRAM_CLIENT} token in a Nest `TestingModule`.
 *
 * Every method is a `jest.fn()` with a sensible, network-free default (an
 * authorized "me" account), so a consumer can inject a working fake client and
 * only override the calls a given test cares about.
 *
 * The `jest` reference is the **ambient global** provided by a Jest runtime;
 * this module never `import`s `jest`, so the `nestjs-telegram/testing` subpath
 * adds no hard dependency on a test runner. Call {@link createMockGramClient}
 * (and {@link provideMockGramClient}) only from inside Jest specs.
 *
 * USAGE
 * -----
 * ```ts
 * import { Test } from '@nestjs/testing';
 * import { createMockGramClient, provideMockGramClient } from 'nestjs-telegram/testing';
 *
 * const client = createMockGramClient({
 *   getDialogs: jest.fn().mockResolvedValue([aGramDialog({ unreadCount: 3 })]),
 * });
 *
 * const moduleRef = await Test.createTestingModule({
 *   providers: [MyService, provideMockGramClient(client)],
 * }).compile();
 * ```
 *
 * KEY EXPORTS
 * -----------
 * - createMockGramClient: Builds a fully-mocked {@link IGramClient}.
 * - provideMockGramClient: A Nest `ValueProvider` binding the fake to the token.
 */

import type { ValueProvider } from '@nestjs/common';

import type { IGramClient } from '../client/gram-client.interface';
import { GRAM_SIGN_IN_STATUSES } from '../client/gram-client.types';
import { TELEGRAM_GRAM_CLIENT } from '../client/telegram-client.constants';
import {
  aGramChatInfo,
  aGramMediaInfo,
  aGramMessage,
  aGramUser,
} from './dto-builders';

/**
 * Builds a fully-mocked {@link IGramClient}. Every method is a `jest.fn()` with a
 * sensible default: the client reports itself connected and authorized, `getMe`
 * resolves a representative account, list/search calls resolve empty arrays,
 * `sendMessage` / `sendFile` / `editMessage` echo a representative message,
 * `download*` calls resolve representative buffers, `getMediaInfo` resolves a
 * representative video descriptor, `streamMedia` yields one chunk, `getFullChat`
 * resolves a representative group, the alternative sign-ins (`signInWithQrCode`,
 * `signInAsBot`) resolve a representative account, and the void calls
 * (`join`/`leaveChannel`, `deleteMessages`, `markAsRead`, `pinMessage`,
 * `updateTwoFactor`) resolve. Pass `overrides` to change the behaviour of any
 * method per test.
 *
 * Because the defaults make `isConnected()` return `true`, the user-account
 * services skip their lazy `connect()` call; override `isConnected` to return
 * `false` to exercise the lazy-connect path.
 *
 * @param overrides - Per-test replacements for any subset of the client methods.
 * @returns A `jest.Mocked<IGramClient>` whose methods are spies.
 * @throws {ReferenceError} If called outside a Jest runtime (no ambient `jest`).
 * @example
 * ```ts
 * const client = createMockGramClient({ isConnected: jest.fn().mockReturnValue(false) });
 * await new TelegramUserService(client).getMe();
 * expect(client.connect).toHaveBeenCalled();
 * ```
 */
export function createMockGramClient(
  overrides: Partial<IGramClient> = {},
): jest.Mocked<IGramClient> {
  // ── Defaults describe a connected, authorized "me" account with no traffic.
  //    Cast is required because `jest.fn().mockResolvedValue(...)` widens past
  //    the precise method signatures; the shape is verified field-by-field. ──
  const base: jest.Mocked<IGramClient> = {
    connect: jest.fn().mockResolvedValue(undefined),
    disconnect: jest.fn().mockResolvedValue(undefined),
    isConnected: jest.fn().mockReturnValue(true),
    isAuthorized: jest.fn().mockResolvedValue(true),
    sendCode: jest
      .fn()
      .mockResolvedValue({ phoneCodeHash: 'TEST_HASH', isCodeViaApp: true }),
    signInWithCode: jest.fn().mockResolvedValue({
      status: GRAM_SIGN_IN_STATUSES.AUTHORIZED,
      user: aGramUser(),
    }),
    signInWithPassword: jest.fn().mockResolvedValue(aGramUser()),
    signInWithQrCode: jest.fn().mockResolvedValue(aGramUser()),
    signInAsBot: jest.fn().mockResolvedValue(aGramUser({ isBot: true })),
    updateTwoFactor: jest.fn().mockResolvedValue(undefined),
    logOut: jest.fn().mockResolvedValue(undefined),
    getMe: jest.fn().mockResolvedValue(aGramUser()),
    getDialogs: jest.fn().mockResolvedValue([]),
    getMessages: jest.fn().mockResolvedValue([]),
    sendMessage: jest.fn().mockResolvedValue(aGramMessage()),
    sendFile: jest.fn().mockResolvedValue(aGramMessage({ hasMedia: true })),
    downloadMedia: jest.fn().mockResolvedValue(Buffer.from('TEST_MEDIA')),
    downloadProfilePhoto: jest
      .fn()
      .mockResolvedValue(Buffer.from('TEST_PHOTO')),
    getMediaInfo: jest.fn().mockResolvedValue(aGramMediaInfo()),
    downloadMediaRange: jest
      .fn()
      .mockResolvedValue(Buffer.from('TEST_RANGE')),
    // ── A fresh single-chunk async iterable per call (re-iterable across
    //    tests because `createMockGramClient` is invoked per test). ──────────
    streamMedia: jest.fn().mockImplementation(
      async () =>
        (async function* () {
          yield Buffer.from('TEST_MEDIA');
        })(),
    ),
    joinChannel: jest.fn().mockResolvedValue(undefined),
    leaveChannel: jest.fn().mockResolvedValue(undefined),
    getParticipants: jest.fn().mockResolvedValue([]),
    searchMessages: jest.fn().mockResolvedValue([]),
    getFullChat: jest.fn().mockResolvedValue(aGramChatInfo()),
    editMessage: jest.fn().mockResolvedValue(aGramMessage()),
    deleteMessages: jest.fn().mockResolvedValue(undefined),
    forwardMessages: jest.fn().mockResolvedValue([]),
    markAsRead: jest.fn().mockResolvedValue(undefined),
    pinMessage: jest.fn().mockResolvedValue(undefined),
    exportSession: jest.fn().mockReturnValue('TEST_SESSION'),
    onNewMessage: jest.fn().mockReturnValue(() => undefined),
    onEditedMessage: jest.fn().mockReturnValue(() => undefined),
    onDeletedMessages: jest.fn().mockReturnValue(() => undefined),
    onChatAction: jest.fn().mockReturnValue(() => undefined),
  } as jest.Mocked<IGramClient>;

  return Object.assign(base, overrides);
}

/**
 * Builds a Nest `ValueProvider` that binds a mock client to the
 * {@link TELEGRAM_GRAM_CLIENT} token, so it can be dropped straight into a
 * `TestingModule`'s `providers` array (or used as the value of an
 * `.overrideProvider(TELEGRAM_GRAM_CLIENT).useValue(...)` call).
 *
 * @param client - The mock client to register; defaults to a fresh
 *   {@link createMockGramClient} when omitted. Build it yourself when you need a
 *   handle to assert against the spies.
 * @returns A `ValueProvider` for the `TELEGRAM_GRAM_CLIENT` token.
 * @throws {ReferenceError} If called without a `client` outside a Jest runtime
 *   (the default builds a `jest.fn()`-backed client).
 * @example
 * ```ts
 * const client = createMockGramClient();
 * const moduleRef = await Test.createTestingModule({
 *   providers: [DigestService, provideMockGramClient(client)],
 * }).compile();
 * ```
 */
export function provideMockGramClient(
  client: jest.Mocked<IGramClient> = createMockGramClient(),
): ValueProvider<jest.Mocked<IGramClient>> {
  return { provide: TELEGRAM_GRAM_CLIENT, useValue: client };
}
