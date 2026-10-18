import { defineConfig } from 'oxlint';

export default defineConfig({
  ignorePatterns: ['assets/**', 'dist/**', 'out/**', 'reports/**', 'research_notes/**', '*.vsix'],
  plugins: ['eslint', 'typescript', 'unicorn', 'oxc', 'import'],
  options: {
    reportUnusedDisableDirectives: 'error',
  },
  categories: {
    correctness: 'error',
    suspicious: 'warn',
  },
  rules: {
    'eslint/eqeqeq': ['error', 'always', { null: 'ignore' }],
    'eslint/no-control-regex': 'error',
    'eslint/no-unused-vars': [
      'error',
      {
        argsIgnorePattern: '^_',
        caughtErrors: 'all',
        caughtErrorsIgnorePattern: '^_',
        ignoreRestSiblings: true,
        varsIgnorePattern: '^_',
      },
    ],
    'eslint/no-useless-assignment': 'off',
    'eslint/no-console': 'warn',
    'eslint/no-debugger': 'error',
    'eslint/no-var': 'error',
    // These names belong to Node's module loader and npm/Yarn metadata.
    'eslint/no-underscore-dangle': ['warn', { allow: ['_load', '_npmUser', '__metadata'] }],
    'eslint/prefer-const': 'error',
    'typescript/no-explicit-any': 'error',
    'typescript/no-require-imports': 'error',
    'typescript/no-namespace': 'error',
    'typescript/consistent-type-imports': 'warn',
    'typescript/no-floating-promises': 'error',
    'typescript/no-misused-promises': 'error',
    'typescript/await-thenable': 'error',
    // Match Varro's incremental adoption of type-aware rules.
    'typescript/consistent-return': 'off',
    'typescript/no-base-to-string': 'off',
    'typescript/no-implied-eval': 'off',
    'typescript/no-meaningless-void-operator': 'off',
    'typescript/no-misused-spread': 'off',
    'typescript/no-redundant-type-constituents': 'off',
    'typescript/no-unnecessary-boolean-literal-compare': 'off',
    'typescript/no-unnecessary-template-expression': 'off',
    'typescript/no-unnecessary-type-arguments': 'off',
    'typescript/no-unnecessary-type-assertion': 'off',
    'typescript/no-unnecessary-type-conversion': 'off',
    'typescript/no-unnecessary-type-parameters': 'off',
    'typescript/no-unsafe-type-assertion': 'off',
    'typescript/require-array-sort-compare': 'off',
    'typescript/restrict-template-expressions': 'off',
    'typescript/unbound-method': 'off',
    'import/no-duplicates': 'error',
    // Keep lifecycle handlers and test helpers beside registration and cleanup.
    'unicorn/consistent-function-scoping': 'off',
  },
  overrides: [
    {
      files: ['**/*.test.ts'],
      rules: {
        // CommonJS imports keep module exports mutable for Node mocks and VS Code stubs.
        'typescript/no-require-imports': 'off',
        // Async mocks and fixture servers are intentional in tests.
        'typescript/no-misused-promises': 'off',
        // Node records failures for test registration promises.
        'typescript/no-floating-promises': [
          'error',
          {
            allowForKnownSafeCalls: [{ from: 'package', name: ['test', 'skip'], package: 'node' }],
          },
        ],
      },
    },
    {
      files: ['esbuild.js', 'scripts/**/*.mjs'],
      rules: {
        'eslint/no-console': 'off',
      },
    },
    {
      files: ['esbuild.js'],
      rules: {
        // This build script runs as CommonJS.
        'typescript/no-require-imports': 'off',
      },
    },
  ],
});
