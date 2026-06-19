/**
 * @file src/bots/greeter/middleware/session.middleware.ts
 *
 * PURPOSE
 * -------
 * Exposes Telegraf session middleware for greeter scene and wizard state.
 *
 * USAGE
 * -----
 * import { greeterSessionMiddleware } from './middleware/session.middleware';
 */

import { session } from 'telegraf';

/** Session middleware used by greeter bot registration. */
export const greeterSessionMiddleware = session();
