import js from '@eslint/js';
import globals from 'globals';

export default [
  { ignores: ['dist/', 'node_modules/', 'design/', 'custom_components/*/frontend/'] },
  js.configs.recommended,
  {
    languageOptions: { ecmaVersion: 2022, sourceType: 'module', globals: { ...globals.browser } },
    rules: { 'no-unused-vars': ['error', { argsIgnorePattern: '^_', caughtErrors: 'none' }] },
  },
  { files: ['scripts/**', 'test/**', 'tools/*.mjs', '*.config.js'], languageOptions: { globals: { ...globals.node } } },
];
