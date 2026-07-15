import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const monorepoRoot = path.join(__dirname, '../..');

const prismaGeneratedClient = '../../packages/db/dist/generated/client';
const prismaServerlessTraceFiles = [
  `${prismaGeneratedClient}/libquery_engine-rhel-openssl-3.0.x.so.node`,
  `${prismaGeneratedClient}/schema.prisma`,
];

/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  transpilePackages: ['@aicaa/domain'],
  serverExternalPackages: ['@aicaa/db'],
  outputFileTracingRoot: monorepoRoot,
  outputFileTracingIncludes: {
    '/api/v1/tasks': prismaServerlessTraceFiles,
    '/api/v1/tasks/**/*': prismaServerlessTraceFiles,
    '/api/v1/capabilities/**/*': prismaServerlessTraceFiles,
  },
  turbopack: {
    root: monorepoRoot,
    rules: {
      '../../packages/db/dist/**': { type: 'node' },
      '../../packages/db/dist/generated/client/**': { type: 'node' },
    },
  },
};

export default nextConfig;
