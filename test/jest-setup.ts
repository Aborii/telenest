/**
 * @file test/jest-setup.ts
 *
 * PURPOSE
 * -------
 * Global Jest setup. Imports `reflect-metadata` once so NestJS dependency
 * injection (which relies on decorator metadata) works inside module tests.
 *
 * USAGE
 * -----
 * Referenced by `jest.config.ts` via `setupFiles`.
 */

import 'reflect-metadata';
