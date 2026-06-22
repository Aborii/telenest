/**
 * @file src/main.ts
 *
 * PURPOSE
 * -------
 * Application bootstrap entry point for standalone NestJS runtime.
 *
 * USAGE
 * -----
 * npm run start:dev
 */

import 'dotenv/config';

import { Logger } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';

import { APP_BOOT_MESSAGE } from './app.constants';
import { AppModule } from './app.module';

/**
 * Boots the Nest standalone application context for bot processing.
 *
 * @returns Promise that resolves after Nest app context is initialized.
 * @throws {Error} If bootstrap cannot initialize application context.
 */
async function bootstrap(): Promise<void> {
  await NestFactory.createApplicationContext(AppModule);
  Logger.log(APP_BOOT_MESSAGE, 'Bootstrap');
}

void bootstrap();
