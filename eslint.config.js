import js from '@eslint/js';
import globals from 'globals';

// The app itself lives inline in index.html, so ESLint only sees the test
// harness and this config. The tests are what guard the app's logic.
export default [
  { ignores: ['node_modules/**', 'coverage/**', 'test/fixtures/**'] },
  js.configs.recommended,
  {
    files: ['test/**/*.js', 'eslint.config.js'],
    languageOptions: {
      ecmaVersion: 'latest',
      sourceType: 'module',
      globals: { ...globals.node },
    },
  },
];
