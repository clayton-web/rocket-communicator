import nextConfig from '@aicaa/eslint-config/next';

/** @type {import('eslint').Linter.Config[]} */
const config = [
  {
    ignores: ['.next/**', 'node_modules/**', 'coverage/**', 'next-env.d.ts'],
  },
  ...nextConfig,
];

export default config;
