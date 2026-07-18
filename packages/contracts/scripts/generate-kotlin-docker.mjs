#!/usr/bin/env node
/**
 * Kotlin OpenAPI generation using a pinned Temurin JDK 17 container.
 *
 * Host Node/pnpm still own install, bundle, and TypeScript generation.
 * Docker supplies Java only — no Node/pnpm image, no baked source image, no secrets.
 *
 * Usage (from repo root after dependencies are installed):
 *   pnpm contracts:generate:docker
 */
import {
  createWriteStream,
  existsSync,
  mkdirSync,
  readFileSync,
  renameSync,
  statSync,
} from 'node:fs';
import { pipeline } from 'node:stream/promises';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { Readable } from 'node:stream';
import { cleanupKotlinOrphans } from './cleanup-kotlin-orphans.mjs';
import { KOTLIN_GENERATE_ARGS } from './kotlin-generator-args.mjs';

/** Pinned Eclipse Temurin JDK 17 — matches GitHub Actions `setup-java` major version 17. */
export const TEMURIN_JDK17_IMAGE = 'eclipse-temurin:17.0.19_10-jdk';

const root = path.dirname(fileURLToPath(import.meta.url));
const contractsRoot = path.resolve(root, '..');
const repoRoot = path.resolve(contractsRoot, '../..');
const cacheDir = path.join(contractsRoot, '.cache');
const openapitoolsPath = path.join(contractsRoot, 'openapitools.json');

function fail(message) {
  console.error(`generate-kotlin-docker: ${message}`);
  process.exit(1);
}

function readGeneratorCliVersion() {
  const config = JSON.parse(readFileSync(openapitoolsPath, 'utf8'));
  const version = config?.['generator-cli']?.version;
  if (typeof version !== 'string' || version.length === 0) {
    fail(`missing generator-cli.version in ${path.relative(repoRoot, openapitoolsPath)}`);
  }
  return version;
}

function assertDockerAvailable() {
  try {
    execFileSync('docker', ['version', '--format', '{{.Server.Version}}'], {
      stdio: ['ignore', 'pipe', 'pipe'],
      encoding: 'utf8',
    });
  } catch {
    fail(
      'Docker is not available. Install/start Docker Desktop, or use host Java with `pnpm contracts:generate`.',
    );
  }
}

async function ensureGeneratorJar(version) {
  mkdirSync(cacheDir, { recursive: true });
  const jarName = `openapi-generator-cli-${version}.jar`;
  const jarPath = path.join(cacheDir, jarName);
  if (existsSync(jarPath) && statSync(jarPath).size > 0) {
    return jarPath;
  }

  const url = `https://repo1.maven.org/maven2/org/openapitools/openapi-generator-cli/${version}/${jarName}`;
  console.log(`generate-kotlin-docker: downloading ${jarName}`);
  const response = await fetch(url);
  if (!response.ok || !response.body) {
    fail(
      `failed to download OpenAPI Generator CLI jar (${response.status} ${response.statusText})`,
    );
  }

  const tempPath = `${jarPath}.partial`;
  await pipeline(Readable.fromWeb(response.body), createWriteStream(tempPath));
  renameSync(tempPath, jarPath);
  return jarPath;
}

function hostUserArgs() {
  if (process.platform === 'win32') {
    return [];
  }
  try {
    const uid = typeof process.getuid === 'function' ? process.getuid() : null;
    const gid = typeof process.getgid === 'function' ? process.getgid() : null;
    if (uid == null || gid == null) {
      return [];
    }
    return ['--user', `${uid}:${gid}`];
  } catch {
    return [];
  }
}

function runGeneratorInDocker(jarPath) {
  const jarRelative = path.relative(contractsRoot, jarPath).split(path.sep).join('/');
  const dockerArgs = [
    'run',
    '--rm',
    ...hostUserArgs(),
    '-e',
    'HOME=/tmp',
    '-e',
    'OPENAPI_GENERATOR_ONLINE=false',
    '-v',
    `${contractsRoot}:/workspace`,
    '-w',
    '/workspace',
    TEMURIN_JDK17_IMAGE,
    'java',
    '-jar',
    jarRelative,
    ...KOTLIN_GENERATE_ARGS,
  ];

  console.log(`generate-kotlin-docker: using ${TEMURIN_JDK17_IMAGE}`);
  execFileSync('docker', dockerArgs, { cwd: contractsRoot, stdio: 'inherit' });
}

async function main() {
  assertDockerAvailable();

  const bundled = path.join(contractsRoot, 'dist', 'openapi.bundled.yaml');
  if (!existsSync(bundled)) {
    fail(
      'missing dist/openapi.bundled.yaml — run bundle first (pnpm contracts:generate:docker does this)',
    );
  }

  const version = readGeneratorCliVersion();
  const jarPath = await ensureGeneratorJar(version);
  runGeneratorInDocker(jarPath);

  const removed = cleanupKotlinOrphans();
  if (removed.length > 0) {
    console.log(`Removed ${removed.length} stale Kotlin generated file(s).`);
  }
  console.log('generate-kotlin-docker: ok');
}

main().catch((error) => {
  fail(error instanceof Error ? error.message : String(error));
});
