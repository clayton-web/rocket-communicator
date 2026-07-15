// @vitest-environment node
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const webRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const repoRoot = path.resolve(webRoot, '../..');
const schemaPath = path.join(repoRoot, 'packages/db/prisma/schema.prisma');
const nextConfigPath = path.join(webRoot, 'next.config.mjs');
const generatedClientDir = path.join(repoRoot, 'packages/db/dist/generated/client');
const verifyScriptPath = path.join(webRoot, 'scripts/verify-prisma-serverless-trace.mjs');
const verifyDbRuntimeScriptPath = path.join(webRoot, 'scripts/verify-db-runtime-resolution.mjs');

const RHEL_ENGINE = 'libquery_engine-rhel-openssl-3.0.x.so.node';

describe('Prisma serverless packaging configuration', () => {
  it('declares native and rhel-openssl-3.0.x binary targets in schema.prisma', () => {
    const schema = fs.readFileSync(schemaPath, 'utf8');
    expect(schema).toMatch(/binaryTargets\s*=\s*\[[^\]]*"native"[^\]]*"rhel-openssl-3\.0\.x"/s);
    expect(schema).toContain('provider      = "prisma-client-js"');
    expect(schema).toContain('output        = "../src/generated/client"');
  });

  it('externalizes @aicaa/db and sets monorepo Prisma trace includes in next.config.mjs', () => {
    const config = fs.readFileSync(nextConfigPath, 'utf8');
    expect(config).toContain("serverExternalPackages: ['@aicaa/db']");
    expect(config).toContain("transpilePackages: ['@aicaa/domain']");
    expect(config).not.toMatch(/transpilePackages:\s*\[[^\]]*@aicaa\/db/);
    expect(config).toContain('outputFileTracingRoot');
    expect(config).toContain('outputFileTracingIncludes');
    expect(config).toContain('turbopack:');
    expect(config).toContain('root: monorepoRoot');
    expect(config).toContain(RHEL_ENGINE);
    expect(config).toContain('schema.prisma');
    expect(config).toContain("'/api/v1/tasks'");
    expect(config).toContain("'/api/v1/tasks/**/*'");
    expect(config).toContain("'/api/v1/capabilities/**/*'");
    expect(config).not.toContain("'/api/v1/session'");
  });

  it('includes the Linux engine in dist/generated/client after db build', () => {
    const rhelEnginePath = path.join(generatedClientDir, RHEL_ENGINE);
    const schemaArtifactPath = path.join(generatedClientDir, 'schema.prisma');
    expect(fs.existsSync(rhelEnginePath)).toBe(true);
    expect(fs.existsSync(schemaArtifactPath)).toBe(true);
  });

  it('passes post-build serverless trace verification when .next output exists', () => {
    const nextDir = path.join(webRoot, '.next');
    if (!fs.existsSync(nextDir)) {
      return;
    }

    const output = execFileSync(process.execPath, [verifyScriptPath], {
      cwd: repoRoot,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    expect(output.trim()).toBe('verify-prisma-serverless-trace: ok');
  });

  it('passes post-build db runtime resolution verification when .next output exists', () => {
    const nextDir = path.join(webRoot, '.next');
    if (!fs.existsSync(nextDir)) {
      return;
    }

    const output = execFileSync(process.execPath, [verifyDbRuntimeScriptPath], {
      cwd: repoRoot,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    expect(output.trim()).toBe('verify-db-runtime-resolution: ok');
  });
});
