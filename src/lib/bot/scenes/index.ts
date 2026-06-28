/**
 * @file src/lib/bot/scenes/index.ts
 *
 * PURPOSE
 * -------
 * Public barrel for the Bot API scene & wizard system: the class/method
 * decorators, the scene metadata/types, the (pure) scene builder, and the
 * discovery-based registrar.
 *
 * USAGE
 * -----
 * import { Scene, WizardScene, SceneEnter, WizardStep } from 'telenest';
 */

export * from './scene.builder';
export * from './scene.decorators';
export * from './scene.types';
export { TelegramBotScenesRegistrar } from './telegram-bot-scenes.registrar';
