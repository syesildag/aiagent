import type { Config } from 'jest';

const config: Config = {
  preset: 'ts-jest/presets/default-esm',
  testEnvironment: 'node',
  verbose: true,
  resolver: "ts-jest-resolver",
  testPathIgnorePatterns: ["<rootDir>/dist/", "<rootDir>/node_modules/"],
  collectCoverage: true,
  coverageReporters: ["json", "lcov", "text", "clover"],
  coverageDirectory: "coverage",
  moduleNameMapper: {
    '^react-markdown$': '<rootDir>/src/__mocks__/react-markdown.tsx',
    '^remark-gfm$': '<rootDir>/src/__mocks__/remark-gfm.ts',
  },
  globals: {
    'ts-jest': {
      "tsconfig": "tsconfig.test.json"
    }
  }
};

export default config;
