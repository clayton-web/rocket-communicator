import baseConfig from '@aicaa/eslint-config/next';

/** @type {import('eslint').Linter.Config[]} */
export default [
  {
    ignores: ['dist/**', 'node_modules/**'],
  },
  ...baseConfig,
];
