/**
 * @file jest.config.ts
 *
 * PURPOSE
 * -------
 * Jest configuration for the library. Uses `ts-jest` so specs run against the
 * same strict TypeScript settings as the source, and collects coverage from the
 * library (`src/lib`) only — the example app and barrels are excluded.
 *
 * USAGE
 * -----
 * npm test            # run once
 * npm run test:cov    # run with coverage
 */

import type { Config } from 'jest';

/** Jest configuration object. */
const config: Config = {
  testEnvironment: 'node',
  moduleFileExtensions: ['js', 'json', 'ts'],
  rootDir: '.',
  roots: ['<rootDir>/src'],
  testRegex: '\\.spec\\.ts$',
  transform: {
    '^.+\\.ts$': [
      'ts-jest',
      { tsconfig: '<rootDir>/tsconfig.json' },
    ],
  },
  setupFiles: ['<rootDir>/test/jest-setup.ts'],
  clearMocks: true,
  collectCoverageFrom: [
    'src/lib/**/*.ts',
    '!src/lib/**/index.ts',
    '!src/lib/**/*.module-definition.ts',
  ],
  coverageDirectory: '<rootDir>/coverage',
};

export default config;
