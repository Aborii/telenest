/**
 * @file src/lib/client/index.ts
 *
 * PURPOSE
 * -------
 * Public barrel for the MTProto (user account) side of the library.
 *
 * USAGE
 * -----
 * import { TelegramClientModule, TelegramAuthService } from 'nestjs-telegram';
 */

export * from './telegram-client.constants';
export * from './telegram-client.options';
export {
  TELEGRAM_CLIENT_OPTIONS,
  type TelegramClientModuleAsyncOptions,
  type TelegramClientModuleForRootOptions,
} from './telegram-client.module-definition';
export * from './gram-client.types';
export * from './gram-client.interface';
export * from './telegram-auth.service';
export * from './telegram-user.service';
export * from './telegram-client.module';
// Note: GramJsClientAdapter is intentionally NOT re-exported here — keeping the
// concrete GramJS-typed class out of the public surface preserves the IGramClient
// abstraction boundary. Use `createGramJsClient` (returns IGramClient) instead.
export { createGramJsClient } from './gramjs-client.adapter';
export * from './session/session-store.interface';
export * from './session/memory-session-store';
export * from './session/file-session-store';
