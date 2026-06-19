/**
 * @file src/bots/echo/echo.service.ts
 *
 * PURPOSE
 * -------
 * Domain logic for echo-related text transformations.
 *
 * USAGE
 * -----
 * import { EchoService } from './echo.service';
 *
 * KEY EXPORTS
 * -----------
 * - EchoService: Stateless service with text transformation helpers.
 */

import { Injectable } from '@nestjs/common';

/**
 * Provides reusable text transformation logic for echo handlers.
 */
@Injectable()
export class EchoService {
  /**
   * Reverses a text value while preserving whitespace placement.
   *
   * @param input - User input text to reverse.
   * @returns A reversed string.
   * @throws {Error} Never intentionally throws.
   */
  reverse(input: string): string {
    return [...input].reverse().join('');
  }
}
