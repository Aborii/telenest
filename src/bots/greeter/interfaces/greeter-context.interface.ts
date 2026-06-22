/**
 * @file src/bots/greeter/interfaces/greeter-context.interface.ts
 *
 * PURPOSE
 * -------
 * Provides a strongly-typed Telegraf context for scene and wizard operations.
 *
 * USAGE
 * -----
 * import { GreeterContext } from './interfaces/greeter-context.interface';
 */

import { Scenes } from 'telegraf';

/** Session payload persisted for greeter scene and wizard flows. */
export interface GreeterSession extends Scenes.WizardSessionData {
  /** Optional user-provided display name collected by the wizard. */
  profileName?: string;
}

/** Context type used by greeter handlers that rely on scene/wizard APIs. */
export type GreeterContext = Scenes.WizardContext<GreeterSession>;
