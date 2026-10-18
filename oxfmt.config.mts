import { defineConfig } from 'oxfmt';

export default defineConfig({
  ignorePatterns: [
    '**/*.md',
    'assets/**',
    'dist/**',
    'out/**',
    'reports/**',
    'research_notes/**',
    'package-lock.json',
    '*.vsix',
  ],
  tabWidth: 2,
  semi: true,
  singleQuote: true,
  trailingComma: 'es5',
});
