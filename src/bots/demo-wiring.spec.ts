/**
 * @file src/bots/demo-wiring.spec.ts
 *
 * PURPOSE
 * -------
 * Coverage for the demo application's wiring: constants, the session
 * middleware, and that each feature module instantiates its providers.
 */

import { Test } from '@nestjs/testing';

import { APP_BOOT_MESSAGE, BOT_NAMES } from '../app.constants';
import { ECHO_GREETINGS, ECHO_HELP_TEXT } from './echo/echo.constants';
import { EchoModule } from './echo/echo.module';
import { EchoService } from './echo/echo.service';
import {
  PROFILE_WIZARD_ID,
  RANDOM_NUMBER_SCENE_ID,
  RANDOM_SCENE_PROMPT,
} from './greeter/greeter.constants';
import { GreeterModule } from './greeter/greeter.module';
import { GreeterUpdate } from './greeter/greeter.update';
import { greeterSessionMiddleware } from './greeter/middleware/session.middleware';

describe('demo app wiring', () => {
  it('exposes stable bot names and a boot message', () => {
    expect(BOT_NAMES.ECHO).toBe('echo');
    expect(BOT_NAMES.GREETER).toBe('greeter');
    expect(typeof APP_BOOT_MESSAGE).toBe('string');
  });

  it('exposes echo constants', () => {
    expect(ECHO_GREETINGS).toContain('hello');
    expect(typeof ECHO_HELP_TEXT).toBe('string');
  });

  it('exposes greeter constants', () => {
    expect(RANDOM_NUMBER_SCENE_ID).toBeTruthy();
    expect(PROFILE_WIZARD_ID).toBeTruthy();
    expect(typeof RANDOM_SCENE_PROMPT).toBe('string');
  });

  it('greeter session middleware is a middleware function', () => {
    expect(typeof greeterSessionMiddleware).toBe('function');
  });

  it('EchoModule resolves its providers', async () => {
    const ref = await Test.createTestingModule({
      imports: [EchoModule],
    }).compile();
    expect(ref.get(EchoService)).toBeInstanceOf(EchoService);
  });

  it('GreeterModule resolves its providers', async () => {
    const ref = await Test.createTestingModule({
      imports: [GreeterModule],
    }).compile();
    expect(ref.get(GreeterUpdate)).toBeInstanceOf(GreeterUpdate);
  });
});
