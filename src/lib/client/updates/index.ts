/**
 * @file src/lib/client/updates/index.ts
 *
 * PURPOSE
 * -------
 * Barrel for the inbound user-account update system.
 *
 * USAGE
 * -----
 * import { OnUserMessage, GramUserMessageContext } from 'nestjs-telegram';
 */

export * from './match-chat-action';
export * from './match-user-deleted';
export * from './match-user-message';
export * from './on-chat-action.decorator';
export * from './on-chat-action.types';
export * from './on-user-deleted.decorator';
export * from './on-user-deleted.types';
export * from './on-user-edited.decorator';
export * from './on-user-message.decorator';
export * from './on-user-message.types';
export * from './telegram-user-updates.registrar';
