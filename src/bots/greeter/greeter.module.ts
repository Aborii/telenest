/**
 * @file src/bots/greeter/greeter.module.ts
 *
 * PURPOSE
 * -------
 * Nest module that assembles greeter updates, scene handlers, and wizard flows.
 *
 * USAGE
 * -----
 * Import GreeterModule in AppModule and include it in bot registration.
 */

import { Module } from '@nestjs/common';

import { GreeterUpdate } from './greeter.update';
import { RandomNumberScene } from './scenes/random-number.scene';
import { ProfileWizard } from './wizard/profile.wizard';

/** Greeter bot feature module. */
@Module({
  providers: [GreeterUpdate, RandomNumberScene, ProfileWizard],
})
export class GreeterModule {}
