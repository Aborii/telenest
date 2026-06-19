/**
 * @file src/bots/echo/echo.module.ts
 *
 * PURPOSE
 * -------
 * Nest module that wires echo bot update handlers and service dependencies.
 *
 * USAGE
 * -----
 * Import EchoModule in AppModule and include it in bot registration.
 */

import { Module } from '@nestjs/common';
import { EchoService } from './echo.service';
import { EchoUpdate } from './echo.update';

/** Echo bot feature module. */
@Module({
  providers: [EchoService, EchoUpdate],
  exports: [EchoService],
})
export class EchoModule {}
