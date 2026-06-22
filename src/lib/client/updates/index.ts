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

export * from './match-user-message';
export * from './on-user-message.decorator';
export * from './on-user-message.types';
export * from './telegram-user-updates.registrar';
