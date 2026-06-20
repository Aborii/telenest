/**
 * @file src/lib/testing/mock-gram-client.ts
 *
 * PURPOSE
 * -------
 * Factory for a fully-mocked {@link IGramClient} suitable for use in Jest
 * tests. Every method is replaced with a `jest.fn()` that returns a sensible
 * default value (so tests only need to override what they actually care about).
 *
 * The factory has **no hard dependency on Jest at runtime** — it calls
 * `jest.fn()` only inside the function body, so it is tree-shakeable and only
 * activates when Jest is actually available. If Jest is not present the call
 * will throw, which is the expected behavior in a non-test environment.
 *
 * USAGE
 * -----
 * ```ts
 * import { createMockGramClient } from 'nestjs-telegram/testing';
 *
 * const client = createMockGramClient({ getMe: jest.fn().mockResolvedValue(aGramUser()) });
 * const service = new TelegramUserService(client);
 * ```
 *
 * KEY EXPORTS
 * -----------
 * - createMockGramClient: Returns a {@link jest.Mocked<IGramClient>} with defaults.
 */

import type { IGramClient } from '../client/gram-client.interface';
import { aGramMessage, aGramUser } from './dto-builders';

/**
 * Creates a fully-mocked {@link IGramClient} with every method stubbed as a
 * `jest.fn()`. Each stub returns a safe default value so test code that does
 * not care about a specific method does not need to configure it.
 *
 * Defaults:
 * - `connect` / `disconnect` / `logOut` → resolve `undefined`
 * - `isConnected` → returns `true`
 * - `isAuthorized` → resolves `true`
 * - `sendCode` → resolves `{ phoneCodeHash: 'MOCK_HASH', isCodeViaApp: true }`
 * - `signInWithCode` → resolves `{ status: 'authorized', user: aGramUser() }`
 * - `signInWithPassword` → resolves `aGramUser()`
 * - `getMe` → resolves `aGramUser()`
 * - `getDialogs` → resolves `[]`
 * - `getMessages` → resolves `[]`
 * - `sendMessage` → resolves `aGramMessage()`
 * - `exportSession` → returns `''`
 * - `onNewMessage` → returns a no-op unsubscribe function
 *
 * @param overrides - Any methods that should use a custom implementation
 *   instead of the default stub. Merges shallowly into the base mock.
 * @returns A {@link jest.Mocked<IGramClient>} ready to be injected.
 * @throws Never (the factory itself cannot throw; the resulting mock may throw
 *   if you configure it to do so via `mockRejectedValue` etc.).
 *
 * @example
 * ```ts
 * const client = createMockGramClient({
 *   getMe: jest.fn().mockResolvedValue(aGramUser({ username: 'bot' })),
 * });
 * ```
 */
export function createMockGramClient(
  overrides: Partial<jest.Mocked<IGramClient>> = {},
): jest.Mocked<IGramClient> {
  // ── Build the base mock with safe defaults ──────────────────────────────
  const base: jest.Mocked<IGramClient> = {
    connect: jest.fn<Promise<void>, []>().mockResolvedValue(undefined),
    disconnect: jest.fn<Promise<void>, []>().mockResolvedValue(undefined),
    isConnected: jest.fn<boolean, []>().mockReturnValue(true),
    isAuthorized: jest.fn<Promise<boolean>, []>().mockResolvedValue(true),
    sendCode: jest
      .fn()
      .mockResolvedValue({ phoneCodeHash: 'MOCK_HASH', isCodeViaApp: true }),
    signInWithCode: jest
      .fn()
      .mockResolvedValue({ status: 'authorized', user: aGramUser() }),
    signInWithPassword: jest.fn().mockResolvedValue(aGramUser()),
    logOut: jest.fn<Promise<void>, []>().mockResolvedValue(undefined),
    getMe: jest.fn().mockResolvedValue(aGramUser()),
    getDialogs: jest.fn().mockResolvedValue([]),
    getMessages: jest.fn().mockResolvedValue([]),
    sendMessage: jest.fn().mockResolvedValue(aGramMessage()),
    exportSession: jest.fn<string, []>().mockReturnValue(''),
    onNewMessage: jest.fn().mockReturnValue(() => undefined),
  };

  // ── Merge caller-supplied overrides shallowly ───────────────────────────
  return Object.assign(base, overrides);
}
