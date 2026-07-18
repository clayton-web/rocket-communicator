import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const monorepoRoot = path.join(__dirname, '../..');

const dbPackageRoot = '../../packages/db';
const domainPackageRoot = '../../packages/domain';
const aiPackageRoot = '../../packages/ai';
const prismaGeneratedClient = `${dbPackageRoot}/dist/generated/client`;
const dbPackageRuntimeTraceFiles = [
  `${dbPackageRoot}/package.json`,
  `${dbPackageRoot}/dist/**/*.js`,
];
const domainPackageRuntimeTraceFiles = [
  `${domainPackageRoot}/package.json`,
  `${domainPackageRoot}/dist/**/*.js`,
];
const aiPackageRuntimeTraceFiles = [
  `${aiPackageRoot}/package.json`,
  `${aiPackageRoot}/dist/**/*.js`,
];
const workspacePackageEntryTraceFiles = [
  '../../apps/web/node_modules/@aicaa/db/package.json',
  '../../apps/web/node_modules/@aicaa/domain/package.json',
  '../../apps/web/node_modules/@aicaa/domain/dist/**/*.js',
];
const workspaceAiPackageEntryTraceFiles = [
  '../../apps/web/node_modules/@aicaa/ai/package.json',
  '../../apps/web/node_modules/@aicaa/ai/dist/**/*.js',
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
/** Narrow AI include for the suggestion process route only (A6.3). */
const suggestionProcessRouteTraceFiles = [
  ...dbBackedRouteTraceFiles,
  ...aiPackageRuntimeTraceFiles,
  ...workspaceAiPackageEntryTraceFiles,
];

/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  transpilePackages: ['@aicaa/domain', '@aicaa/ai'],
  // @aicaa/db and google-auth-library are Node-only; keep them out of client/edge bundles.
  serverExternalPackages: ['@aicaa/db', 'google-auth-library'],
  outputFileTracingRoot: monorepoRoot,
  outputFileTracingIncludes: {
    '/api/v1/tasks': dbBackedRouteTraceFiles,
    '/api/v1/tasks/**/*': dbBackedRouteTraceFiles,
    '/api/v1/task-suggestions': dbBackedRouteTraceFiles,
    '/api/v1/task-suggestions/**/*': dbBackedRouteTraceFiles,
    '/api/v1/capabilities/**/*': dbBackedRouteTraceFiles,
    '/api/v1/gmail/**/*': dbBackedRouteTraceFiles,
    '/api/v1/internal/suggestions/process': suggestionProcessRouteTraceFiles,
    '/api/v1/internal/**/*': dbBackedRouteTraceFiles,
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
