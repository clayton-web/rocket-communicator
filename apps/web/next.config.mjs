import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const monorepoRoot = path.join(__dirname, '../..');

const dbPackageRoot = '../../packages/db';
const domainPackageRoot = '../../packages/domain';
const prismaGeneratedClient = `${dbPackageRoot}/dist/generated/client`;
const dbPackageRuntimeTraceFiles = [
  `${dbPackageRoot}/package.json`,
  `${dbPackageRoot}/dist/**/*.js`,
];
const domainPackageRuntimeTraceFiles = [
  `${domainPackageRoot}/package.json`,
  `${domainPackageRoot}/dist/**/*.js`,
];
const workspacePackageEntryTraceFiles = [
  '../../apps/web/node_modules/@aicaa/db/package.json',
  '../../apps/web/node_modules/@aicaa/domain/package.json',
];
const prismaServerlessTraceFiles = [
  `${prismaGeneratedClient}/libquery_engine-rhel-openssl-3.0.x.so.node`,
  `${prismaGeneratedClient}/schema.prisma`,
];
const dbBackedRouteTraceFiles = [
  ...dbPackageRuntimeTraceFiles,
  ...domainPackageRuntimeTraceFiles,
  ...workspacePackageEntryTraceFiles,
  ...prismaServerlessTraceFiles,
];

/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  transpilePackages: ['@aicaa/domain'],
  serverExternalPackages: ['@aicaa/db'],
  outputFileTracingRoot: monorepoRoot,
  outputFileTracingIncludes: {
    '/api/v1/tasks': dbBackedRouteTraceFiles,
    '/api/v1/tasks/**/*': dbBackedRouteTraceFiles,
    '/api/v1/capabilities/**/*': dbBackedRouteTraceFiles,
    '/c/[token]': dbBackedRouteTraceFiles,
    '/c/**/*': dbBackedRouteTraceFiles,
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
