/**
 * Linux-faithful Prisma client construction probe for traced NFT Lambda layouts.
 * No production credentials or external network access.
 */
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath, pathToFileURL } from 'node:url';
import {
  DB_RUNTIME_RELATIVE,
  RHEL_ENGINE,
  SCHEMA_FILE,
  assertIsolatedNftLayoutOutsideRepo,
  materializeNftLayout,
} from './db-package-trace.mjs';

export const GENERATED_CLIENT_RELATIVE = 'packages/db/dist/generated/client';
export const GENERATED_CLIENT_INDEX_RELATIVE = `${GENERATED_CLIENT_RELATIVE}/index.js`;
export const GENERATED_CLIENT_LIBRARY_RELATIVE = `${GENERATED_CLIENT_RELATIVE}/runtime/library.js`;
export const GENERATED_CLIENT_SCHEMA_RELATIVE = `${GENERATED_CLIENT_RELATIVE}/${SCHEMA_FILE}`;
export const GENERATED_CLIENT_ENGINE_RELATIVE = `${GENERATED_CLIENT_RELATIVE}/${RHEL_ENGINE}`;
export const GENERATED_CLIENT_PACKAGE_JSON_RELATIVE = `${GENERATED_CLIENT_RELATIVE}/package.json`;

export const PLACEHOLDER_DATABASE_URL = 'postgresql://probe:probe@127.0.0.1:9/probe?schema=public';

export const PRISMA_PROBE_CLASSIFICATIONS = [
  'SCHEMA_NOT_COLOCATED',
  'ENGINE_NOT_COLOCATED',
  'ENGINE_BINARY_INCOMPATIBLE',
  'GENERATED_CLIENT_RUNTIME_MISSING',
  'CONSTRUCTION_SUCCEEDED',
  'CONNECT_REACHED_DATABASE_NETWORK',
  'UNKNOWN_PRISMA_INITIALIZATION_FAILURE',
];

const REPO_ROOT_SEGMENTS = [
  'packages/db/dist/generated/client',
  'packages/db/src/generated/client',
];

function safeReadString(value, key) {
  if (
    value === null ||
    value === undefined ||
    (typeof value !== 'object' && typeof value !== 'function')
  ) {
    return undefined;
  }
  try {
    const candidate = Reflect.get(value, key);
    return typeof candidate === 'string' && candidate.length > 0 ? candidate : undefined;
  } catch {
    return undefined;
  }
}

function nodeErrorCodeFromCause(error) {
  const seen = new Set();
  let current = error;
  let depth = 0;
  while (current !== null && current !== undefined && depth < 12) {
    if (typeof current === 'object' || typeof current === 'function') {
      if (seen.has(current)) {
        break;
      }
      seen.add(current);
    }
    const code = safeReadString(current, 'code');
    if (code) {
      return code;
    }
    try {
      current = Reflect.get(current, 'cause');
    } catch {
      break;
    }
    depth += 1;
  }
  return undefined;
}

export function sanitizeGeneratorOutputShape(rawValue) {
  if (typeof rawValue !== 'string' || rawValue.length === 0) {
    return undefined;
  }

  const normalized = rawValue.replace(/\\/g, '/');

  if (normalized.includes('/vercel/path0/')) {
    const after = normalized.split('/vercel/path0/')[1];
    return after ? `<build-root>/${after}` : '<build-root>';
  }

  for (const segment of REPO_ROOT_SEGMENTS) {
    const index = normalized.indexOf(segment);
    if (index !== -1) {
      return normalized.slice(index);
    }
  }

  if (normalized.startsWith('/')) {
    return '<absolute-build-path>';
  }

  return normalized;
}

function readEmbeddedGeneratorOutputShape(indexJsPath) {
  if (!fs.existsSync(indexJsPath)) {
    return undefined;
  }
  const content = fs.readFileSync(indexJsPath, 'utf8');
  const match = content.match(/"output"\s*:\s*\{[^}]*"value"\s*:\s*"([^"]+)"/);
  return match ? sanitizeGeneratorOutputShape(match[1]) : undefined;
}

function dirnameFallbackWouldActivate(indexJsPath) {
  if (!fs.existsSync(indexJsPath)) {
    return true;
  }
  return !fs.existsSync(path.join(path.dirname(indexJsPath), SCHEMA_FILE));
}

export function inspectPrismaLayoutArtifacts(layoutRoot) {
  const indexJsPath = path.join(layoutRoot, GENERATED_CLIENT_INDEX_RELATIVE);
  const clientDir = path.join(layoutRoot, GENERATED_CLIENT_RELATIVE);
  const indexDir = path.dirname(indexJsPath);

  const artifacts = {
    indexJs: fs.existsSync(indexJsPath),
    libraryJs: fs.existsSync(path.join(layoutRoot, GENERATED_CLIENT_LIBRARY_RELATIVE)),
    schemaPrisma: fs.existsSync(path.join(layoutRoot, GENERATED_CLIENT_SCHEMA_RELATIVE)),
    rhelEngine: fs.existsSync(path.join(layoutRoot, GENERATED_CLIENT_ENGINE_RELATIVE)),
    packageJson: fs.existsSync(path.join(layoutRoot, GENERATED_CLIENT_PACKAGE_JSON_RELATIVE)),
  };

  const schemaColocatedWithIndex = fs.existsSync(path.join(indexDir, SCHEMA_FILE));
  const engineColocatedWithIndex = fs.existsSync(path.join(indexDir, RHEL_ENGINE));

  return {
    clientModuleRelative: GENERATED_CLIENT_INDEX_RELATIVE,
    runtimeModuleRelative: DB_RUNTIME_RELATIVE,
    artifacts,
    schemaColocatedWithIndex,
    engineColocatedWithIndex,
    selectedBinaryTarget: 'rhel-openssl-3.0.x',
    engineFilename: RHEL_ENGINE,
    dirnameFallbackWouldActivate: dirnameFallbackWouldActivate(indexJsPath),
    embeddedGeneratorOutputShape: readEmbeddedGeneratorOutputShape(indexJsPath),
    embeddedGeneratorOutputPointsToDist:
      readEmbeddedGeneratorOutputShape(indexJsPath) === 'packages/db/dist/generated/client',
    embeddedGeneratorOutputPointsToSrc:
      readEmbeddedGeneratorOutputShape(indexJsPath) === 'packages/db/src/generated/client',
    engineSearchRoots: [
      GENERATED_CLIENT_RELATIVE,
      'packages/db/dist/generated',
      readEmbeddedGeneratorOutputShape(indexJsPath) ?? '<embedded-generator-output>',
      'packages/db/.prisma/client',
    ],
  };
}

function internalEngineLocateFailure(error) {
  const message = safeReadString(error, 'message') ?? '';
  return message.includes('could not locate the Query Engine');
}

function internalBinaryIncompatible(error) {
  const message = safeReadString(error, 'message') ?? '';
  const nodeCode = nodeErrorCodeFromCause(error);
  if (nodeCode === 'ERR_DLOPEN_FAILED' || nodeCode === 'ENOENT') {
    return nodeCode === 'ERR_DLOPEN_FAILED';
  }
  return /invalid ELF|wrong ELF class|cannot open shared object|libssl|OpenSSL/i.test(message);
}

export function classifyPrismaProbeFailure(error, { phase, artifacts }) {
  const errorName = safeReadString(error, 'name');
  const prismaErrorCode = safeReadString(error, 'errorCode');
  const nodeErrorCode = nodeErrorCodeFromCause(error);

  if (nodeErrorCode === 'MODULE_NOT_FOUND' || nodeErrorCode === 'ERR_MODULE_NOT_FOUND') {
    return 'GENERATED_CLIENT_RUNTIME_MISSING';
  }

  if (internalBinaryIncompatible(error)) {
    return 'ENGINE_BINARY_INCOMPATIBLE';
  }

  if (phase === 'connect' && prismaErrorCode === 'P1001') {
    return 'CONNECT_REACHED_DATABASE_NETWORK';
  }

  if (errorName === 'PrismaClientInitializationError') {
    if (!artifacts?.schemaColocatedWithIndex) {
      return 'SCHEMA_NOT_COLOCATED';
    }
    if (!artifacts?.engineColocatedWithIndex) {
      return 'ENGINE_NOT_COLOCATED';
    }
    if (internalEngineLocateFailure(error)) {
      return 'ENGINE_NOT_COLOCATED';
    }
    if (prismaErrorCode?.startsWith('P1')) {
      return 'UNKNOWN_PRISMA_INITIALIZATION_FAILURE';
    }
    return 'UNKNOWN_PRISMA_INITIALIZATION_FAILURE';
  }

  return 'UNKNOWN_PRISMA_INITIALIZATION_FAILURE';
}

export function stripNonRhelQueryEngines(layoutRoot) {
  const clientDir = path.join(layoutRoot, GENERATED_CLIENT_RELATIVE);
  if (!fs.existsSync(clientDir)) {
    return;
  }
  for (const entry of fs.readdirSync(clientDir)) {
    if (entry.startsWith('libquery_engine-') && entry !== RHEL_ENGINE) {
      fs.unlinkSync(path.join(clientDir, entry));
    }
  }
}

function writeProbeRunnerScript({ layoutRoot, runtimePath, artifacts }) {
  const runnerPath = path.join(layoutRoot, 'prisma-client-construction-probe-runner.mjs');
  const source = `
import { pathToFileURL } from 'node:url';

const placeholderUrl = ${JSON.stringify(PLACEHOLDER_DATABASE_URL)};
const runtimePath = ${JSON.stringify(runtimePath)};
const artifacts = ${JSON.stringify(artifacts)};

function safeReadString(value, key) {
  if (value === null || value === undefined || (typeof value !== 'object' && typeof value !== 'function')) {
    return undefined;
  }
  try {
    const candidate = Reflect.get(value, key);
    return typeof candidate === 'string' && candidate.length > 0 ? candidate : undefined;
  } catch {
    return undefined;
  }
}

function nodeErrorCodeFromCause(error) {
  const seen = new Set();
  let current = error;
  let depth = 0;
  while (current !== null && current !== undefined && depth < 12) {
    if (typeof current === 'object' || typeof current === 'function') {
      if (seen.has(current)) break;
      seen.add(current);
    }
    const code = safeReadString(current, 'code');
    if (code) return code;
    try { current = Reflect.get(current, 'cause'); } catch { break; }
    depth += 1;
  }
  return undefined;
}

function classify(error, phase) {
  const errorName = safeReadString(error, 'name');
  const prismaErrorCode = safeReadString(error, 'errorCode');
  const nodeErrorCode = nodeErrorCodeFromCause(error);
  const message = safeReadString(error, 'message') ?? '';

  if (nodeErrorCode === 'MODULE_NOT_FOUND' || nodeErrorCode === 'ERR_MODULE_NOT_FOUND') {
    return 'GENERATED_CLIENT_RUNTIME_MISSING';
  }
  if (nodeErrorCode === 'ERR_DLOPEN_FAILED' || /invalid ELF|wrong ELF class|cannot open shared object|libssl|OpenSSL/i.test(message)) {
    return 'ENGINE_BINARY_INCOMPATIBLE';
  }
  if (phase === 'connect' && prismaErrorCode === 'P1001') {
    return 'CONNECT_REACHED_DATABASE_NETWORK';
  }
  if (errorName === 'PrismaClientInitializationError') {
    if (!artifacts.schemaColocatedWithIndex) return 'SCHEMA_NOT_COLOCATED';
    if (!artifacts.engineColocatedWithIndex) return 'ENGINE_NOT_COLOCATED';
    if (message.includes('could not locate the Query Engine')) return 'ENGINE_NOT_COLOCATED';
    return 'UNKNOWN_PRISMA_INITIALIZATION_FAILURE';
  }
  return 'UNKNOWN_PRISMA_INITIALIZATION_FAILURE';
}

function safeErrorSummary(error) {
  return {
    errorName: safeReadString(error, 'name'),
    prismaErrorCode: safeReadString(error, 'errorCode'),
    nodeErrorCode: nodeErrorCodeFromCause(error),
    clientVersion: safeReadString(error, 'clientVersion'),
  };
}

const runtime = await import(pathToFileURL(runtimePath).href);
if (typeof runtime.createPrismaClient !== 'function') {
  console.log(JSON.stringify({
    probe1: { classification: 'GENERATED_CLIENT_RUNTIME_MISSING', constructed: false },
    probe2: { skipped: true },
  }));
  process.exit(0);
}

let probe1;
let probe2 = { skipped: true };

try {
  const client = runtime.createPrismaClient(placeholderUrl);
  probe1 = { classification: 'CONSTRUCTION_SUCCEEDED', constructed: true };
  try {
    await client.$connect();
    probe2 = { classification: 'UNKNOWN_PRISMA_INITIALIZATION_FAILURE', connected: true };
  } catch (error) {
    probe2 = {
      classification: classify(error, 'connect'),
      connected: false,
      ...safeErrorSummary(error),
    };
  } finally {
    try { await client.$disconnect(); } catch {}
  }
} catch (error) {
  probe1 = {
    classification: classify(error, 'construct'),
    constructed: false,
    ...safeErrorSummary(error),
  };
}

console.log(JSON.stringify({ probe1, probe2 }));
`;
  fs.writeFileSync(runnerPath, source);
  return runnerPath;
}

export function runPrismaClientConstructionProbe({
  webRoot,
  repoRoot,
  nftRelativePath = 'app/api/v1/tasks/route.js.nft.json',
  nodeExecutable = process.execPath,
}) {
  const { layoutRoot } = materializeNftLayout({
    webRoot,
    repoRoot,
    nftRelativePath,
    includeWorkspaceSymlinks: false,
  });

  try {
    assertIsolatedNftLayoutOutsideRepo(layoutRoot, repoRoot);
    stripNonRhelQueryEngines(layoutRoot);

    const artifacts = inspectPrismaLayoutArtifacts(layoutRoot);
    const runtimePath = path.join(layoutRoot, DB_RUNTIME_RELATIVE);

    if (!artifacts.artifacts.indexJs || !artifacts.artifacts.libraryJs) {
      return {
        layoutRoot,
        platform: process.platform,
        nodeVersion: process.version,
        artifacts,
        probe1: {
          classification: 'GENERATED_CLIENT_RUNTIME_MISSING',
          constructed: false,
        },
        probe2: { skipped: true },
      };
    }

    if (!artifacts.schemaColocatedWithIndex) {
      return {
        layoutRoot,
        platform: process.platform,
        nodeVersion: process.version,
        artifacts,
        probe1: {
          classification: 'SCHEMA_NOT_COLOCATED',
          constructed: false,
        },
        probe2: { skipped: true },
      };
    }

    if (!artifacts.engineColocatedWithIndex) {
      return {
        layoutRoot,
        platform: process.platform,
        nodeVersion: process.version,
        artifacts,
        probe1: {
          classification: 'ENGINE_NOT_COLOCATED',
          constructed: false,
        },
        probe2: { skipped: true },
      };
    }

    if (!fs.existsSync(runtimePath)) {
      return {
        layoutRoot,
        platform: process.platform,
        nodeVersion: process.version,
        artifacts,
        probe1: {
          classification: 'GENERATED_CLIENT_RUNTIME_MISSING',
          constructed: false,
        },
        probe2: { skipped: true },
      };
    }

    const runnerPath = writeProbeRunnerScript({ layoutRoot, runtimePath, artifacts });
    const proc = spawnSync(nodeExecutable, [runnerPath], {
      cwd: layoutRoot,
      encoding: 'utf8',
      env: {
        ...process.env,
        NODE_ENV: 'production',
        DATABASE_URL: PLACEHOLDER_DATABASE_URL,
      },
    });

    if (proc.status !== 0) {
      throw new Error(
        proc.stderr?.trim() ||
          proc.stdout?.trim() ||
          'prisma client construction probe runner failed',
      );
    }

    const parsed = JSON.parse(proc.stdout.trim());
    return {
      layoutRoot,
      platform: process.platform,
      nodeVersion: process.version,
      artifacts,
      probe1: parsed.probe1,
      probe2: parsed.probe2,
    };
  } finally {
    fs.rmSync(layoutRoot, { recursive: true, force: true });
  }
}

export function assertPrismaClientConstructionProbeSuccess(result) {
  const failures = [];

  if (result.probe1?.classification !== 'CONSTRUCTION_SUCCEEDED') {
    failures.push(`probe1=${result.probe1?.classification ?? 'missing'}`);
  }

  if (result.probe2?.skipped) {
    failures.push('probe2=skipped');
  } else if (result.probe2?.classification !== 'CONNECT_REACHED_DATABASE_NETWORK') {
    failures.push(`probe2=${result.probe2?.classification ?? 'missing'}`);
  }

  if (failures.length > 0) {
    throw new Error(failures.join(', '));
  }
}

export function isLinuxPlatform() {
  return process.platform === 'linux';
}

export function repoRootFromScript(importMetaUrl) {
  const scriptDir = path.dirname(fileURLToPath(importMetaUrl));
  const webRoot = path.resolve(scriptDir, '..');
  return path.resolve(webRoot, '../..');
}

export function webRootFromScript(importMetaUrl) {
  const scriptDir = path.dirname(fileURLToPath(importMetaUrl));
  return path.resolve(scriptDir, '..');
}

const EXPECTED_CI_ENGINE_BYTE_LENGTH = 17547808;
const EXPECTED_CI_ENGINE_SHA256 =
  'a2924eab1c78a0a7bb67edac5738939fa10589ef073af5542f53812a22e4a7d8';
const ELF_MAGIC = Buffer.from([0x7f, 0x45, 0x4c, 0x46]);
const ELFCLASS64 = 2;
const EM_X86_64 = 62;

function classifyEngineIdentityFromBytes(contents, readable) {
  if (!readable) {
    return {
      prismaEngineByteLength: undefined,
      prismaEngineSha256: undefined,
      prismaEngineReadable: false,
      prismaEngineExecutable: false,
      prismaEngineElfMagicValid: false,
      prismaEngineElfClass: 'UNKNOWN',
      prismaEngineArchitecture: 'UNKNOWN',
      prismaEngineIdentity: 'UNREADABLE',
    };
  }

  const byteLength = contents.length;
  let sha256;
  try {
    sha256 = createHash('sha256').update(contents).digest('hex');
  } catch {
    sha256 = undefined;
  }

  const elfMagicValid = contents.length >= 4 && contents.subarray(0, 4).equals(ELF_MAGIC);
  let elfClass = 'UNKNOWN';
  let architecture = 'UNKNOWN';
  if (elfMagicValid && contents.length >= 20) {
    elfClass = contents[4] === ELFCLASS64 ? 'ELF64' : 'OTHER';
    const eiData = contents[5];
    if (eiData === 1 || eiData === 2) {
      const eMachine = eiData === 1 ? contents.readUInt16LE(18) : contents.readUInt16BE(18);
      architecture = eMachine === EM_X86_64 ? 'X86_64' : 'OTHER';
    }
  } else if (!elfMagicValid) {
    elfClass = 'OTHER';
    architecture = 'OTHER';
  }

  let identity = 'UNKNOWN';
  if (!elfMagicValid || elfClass !== 'ELF64') {
    identity = 'INVALID_ELF';
  } else if (architecture !== 'X86_64') {
    identity = 'WRONG_ARCHITECTURE';
  } else if (byteLength !== EXPECTED_CI_ENGINE_BYTE_LENGTH) {
    identity = 'SIZE_MISMATCH';
  } else if (sha256 !== EXPECTED_CI_ENGINE_SHA256) {
    identity = 'HASH_MISMATCH';
  } else {
    identity = 'MATCHES_CI_ENGINE';
  }

  return {
    prismaEngineByteLength: byteLength,
    prismaEngineSha256: sha256,
    prismaEngineReadable: true,
    prismaEngineExecutable: true,
    prismaEngineElfMagicValid: elfMagicValid,
    prismaEngineElfClass: elfClass,
    prismaEngineArchitecture: architecture,
    prismaEngineIdentity: identity,
  };
}

function classifySyntheticFailure(error) {
  const errorName = safeReadString(error, 'name');
  const prismaErrorCode = safeReadString(error, 'errorCode');
  const nodeErrorCode = nodeErrorCodeFromCause(error);
  const message = safeReadString(error, 'message') ?? '';

  let failureClass = 'UNKNOWN';
  if (nodeErrorCode === 'EACCES' || /permission denied|EACCES/i.test(message)) {
    failureClass = 'ENGINE_PERMISSION_DENIED';
  } else if (/GLIBC|glibc version/i.test(message)) {
    failureClass = 'GLIBC_INCOMPATIBLE';
  } else if (/libssl|libcrypto|OpenSSL/i.test(message)) {
    failureClass = 'OPENSSL_LIBRARY_MISSING';
  } else if (/invalid ELF|wrong ELF class|ELFCLASS|wrong.*architecture/i.test(message)) {
    failureClass = 'ELF_ARCHITECTURE_MISMATCH';
  } else if (/truncat|unexpected end of file|file too short/i.test(message)) {
    failureClass = 'ENGINE_FILE_TRUNCATED';
  } else if (
    nodeErrorCode === 'ERR_DLOPEN_FAILED' ||
    /ERR_DLOPEN_FAILED|cannot open shared object|dlopen/i.test(message)
  ) {
    failureClass = 'ENGINE_DLOPEN_FAILED';
  } else if (errorName === 'PrismaClientInitializationError') {
    failureClass = 'UNKNOWN';
  }

  return {
    errorClass: errorName,
    prismaErrorCode,
    nodeErrorCode,
    failureClass,
  };
}

/**
 * Optional Linux NFT synthetic engine-failure matrix.
 * Does not connect to an external database. Never mutates the repository engine.
 * Failures here must not weaken the unmodified CASE E probe.
 */
export function runPrismaEngineSyntheticMatrix({
  webRoot,
  repoRoot,
  nftRelativePath = 'app/api/v1/tasks/route.js.nft.json',
  nodeExecutable = process.execPath,
}) {
  const { layoutRoot } = materializeNftLayout({
    webRoot,
    repoRoot,
    nftRelativePath,
    includeWorkspaceSymlinks: false,
  });

  try {
    assertIsolatedNftLayoutOutsideRepo(layoutRoot, repoRoot);
    stripNonRhelQueryEngines(layoutRoot);

    const enginePath = path.join(layoutRoot, GENERATED_CLIENT_ENGINE_RELATIVE);
    const runtimePath = path.join(layoutRoot, DB_RUNTIME_RELATIVE);
    if (!fs.existsSync(enginePath) || !fs.existsSync(runtimePath)) {
      return { skipped: true, reason: 'ENGINE_OR_RUNTIME_MISSING', variants: [] };
    }

    const originalEngine = fs.readFileSync(enginePath);
    const artifacts = inspectPrismaLayoutArtifacts(layoutRoot);
    const runnerPath = writeProbeRunnerScript({ layoutRoot, runtimePath, artifacts });

    const variants = [
      {
        name: 'truncated',
        apply: () => fs.writeFileSync(enginePath, originalEngine.subarray(0, 4096)),
      },
      {
        name: 'zero_length',
        apply: () => fs.writeFileSync(enginePath, Buffer.alloc(0)),
      },
      {
        name: 'non_elf',
        apply: () => fs.writeFileSync(enginePath, Buffer.from('not-an-elf-engine-fixture')),
      },
      {
        name: 'corrupted',
        apply: () => {
          const copy = Buffer.from(originalEngine);
          copy[Math.floor(copy.length / 2)] ^= 0xff;
          fs.writeFileSync(enginePath, copy);
        },
      },
      {
        name: 'unreadable',
        apply: () => {
          fs.writeFileSync(enginePath, originalEngine);
          fs.chmodSync(enginePath, 0o000);
        },
        restoreMode: true,
      },
    ];

    const results = [];
    for (const variant of variants) {
      try {
        variant.apply();
        let contents = Buffer.alloc(0);
        let readable = false;
        try {
          fs.accessSync(enginePath, fs.constants.R_OK);
          contents = fs.readFileSync(enginePath);
          readable = true;
        } catch {
          readable = false;
        }
        const identity = classifyEngineIdentityFromBytes(contents, readable);

        const proc = spawnSync(nodeExecutable, [runnerPath], {
          cwd: layoutRoot,
          encoding: 'utf8',
          env: {
            ...process.env,
            NODE_ENV: 'production',
            DATABASE_URL: PLACEHOLDER_DATABASE_URL,
          },
        });

        let probeSummary = {
          errorClass: undefined,
          prismaErrorCode: undefined,
          nodeErrorCode: undefined,
          failureClass: 'UNKNOWN',
        };

        if (proc.status === 0) {
          try {
            const parsed = JSON.parse(proc.stdout.trim());
            const failing = parsed.probe1?.constructed === false ? parsed.probe1 : parsed.probe2;
            probeSummary = {
              errorClass: failing?.errorName,
              prismaErrorCode: failing?.prismaErrorCode,
              nodeErrorCode: failing?.nodeErrorCode,
              failureClass:
                failing?.classification === 'ENGINE_BINARY_INCOMPATIBLE'
                  ? 'ENGINE_DLOPEN_FAILED'
                  : failing?.classification === 'CONNECT_REACHED_DATABASE_NETWORK'
                    ? 'OTHER'
                    : 'UNKNOWN',
            };
            if (failing?.errorName || failing?.nodeErrorCode) {
              probeSummary = {
                ...probeSummary,
                ...classifySyntheticFailure({
                  name: failing.errorName,
                  errorCode: failing.prismaErrorCode,
                  code: failing.nodeErrorCode,
                  message: '',
                }),
              };
            }
          } catch {
            probeSummary = { ...probeSummary, failureClass: 'UNKNOWN' };
          }
        } else {
          probeSummary = {
            errorClass: undefined,
            prismaErrorCode: undefined,
            nodeErrorCode: undefined,
            failureClass: 'UNKNOWN',
          };
        }

        results.push({
          variant: variant.name,
          errorClass: probeSummary.errorClass,
          prismaErrorCode: probeSummary.prismaErrorCode,
          nodeErrorCode: probeSummary.nodeErrorCode,
          failureClass: probeSummary.failureClass,
          engineIdentity: identity.prismaEngineIdentity,
        });
      } finally {
        try {
          if (variant.restoreMode) {
            fs.chmodSync(enginePath, 0o755);
          }
          fs.writeFileSync(enginePath, originalEngine);
          fs.chmodSync(enginePath, 0o755);
        } catch {
          // Best-effort restore between variants.
        }
      }
    }

    return { skipped: false, variants: results };
  } finally {
    fs.rmSync(layoutRoot, { recursive: true, force: true });
  }
}
