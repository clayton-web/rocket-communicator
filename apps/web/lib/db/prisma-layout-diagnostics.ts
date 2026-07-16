/**
 * Temporary allowlisted Prisma generated-client layout diagnostics.
 * Reports only fixed booleans/enums/safe hashes — never paths, messages, stacks, or URLs.
 */
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { safeReadProperty } from '@/lib/db/diagnostics';
import { updateDbStageContext } from '@/lib/db/stage-context';
import { getLastResolvedTracedRuntimePath } from '@/lib/db/traced-runtime-path';

export const RHEL_ENGINE_FILENAME = 'libquery_engine-rhel-openssl-3.0.x.so.node' as const;
export const PRISMA_SCHEMA_FILENAME = 'schema.prisma' as const;
export const PRISMA_CLIENT_INDEX_FILENAME = 'index.js' as const;
export const PRISMA_RUNTIME_LIBRARY_RELATIVE = path.join('runtime', 'library.js');
export const PRISMA_GENERATED_PACKAGE_FILENAME = 'package.json' as const;

/** Known CI-tested RHEL OpenSSL 3 query-engine identity (Prisma 6.19.3). */
export const EXPECTED_CI_ENGINE_BYTE_LENGTH = 17547808 as const;
export const EXPECTED_CI_ENGINE_SHA256 =
  'a2924eab1c78a0a7bb67edac5738939fa10589ef073af5542f53812a22e4a7d8' as const;

/** Cap adjacent-engine reads to avoid unbounded hashing. */
const MAX_ENGINE_READ_BYTES = 32 * 1024 * 1024;
const ELF_MAGIC = Buffer.from([0x7f, 0x45, 0x4c, 0x46]);
const ELFCLASS64 = 2;
const EM_X86_64 = 62;

export type PrismaExpectedEngineTarget = 'RHEL_OPENSSL_3' | 'OTHER' | 'UNKNOWN';

export type PrismaEngineElfClass = 'ELF64' | 'OTHER' | 'UNKNOWN';
export type PrismaEngineArchitecture = 'X86_64' | 'OTHER' | 'UNKNOWN';

export type PrismaEngineIdentityClass =
  | 'MATCHES_CI_ENGINE'
  | 'SIZE_MISMATCH'
  | 'HASH_MISMATCH'
  | 'UNREADABLE'
  | 'INVALID_ELF'
  | 'WRONG_ARCHITECTURE'
  | 'UNKNOWN';

export type PrismaLayoutFailureClass =
  | 'ENGINE_NOT_FOUND'
  | 'ENGINE_LOAD_FAILED'
  | 'ENGINE_DLOPEN_FAILED'
  | 'OPENSSL_LIBRARY_MISSING'
  | 'GLIBC_INCOMPATIBLE'
  | 'ELF_ARCHITECTURE_MISMATCH'
  | 'NATIVE_MODULE_REGISTRATION_FAILED'
  | 'ENGINE_PERMISSION_DENIED'
  | 'ENGINE_FILE_TRUNCATED'
  | 'ENGINE_CHECKSUM_MISMATCH'
  | 'QUERY_ENGINE_PANIC'
  | 'SCHEMA_NOT_FOUND'
  | 'GENERATED_CLIENT_RUNTIME_MISSING'
  | 'WRONG_CLIENT_DIRECTORY'
  | 'BINARY_TARGET_MISMATCH'
  | 'DATASOURCE_CONFIGURATION'
  | 'OTHER'
  | 'UNKNOWN';

export interface PrismaEngineIdentityProbe {
  prismaEngineByteLength: number | undefined;
  prismaEngineSha256: string | undefined;
  prismaEngineReadable: boolean;
  prismaEngineExecutable: boolean;
  prismaEngineElfMagicValid: boolean;
  prismaEngineElfClass: PrismaEngineElfClass;
  prismaEngineArchitecture: PrismaEngineArchitecture;
  prismaEngineIdentity: PrismaEngineIdentityClass;
}

export interface PrismaLayoutProbeResult extends PrismaEngineIdentityProbe {
  prismaClientIndexPresent: boolean;
  prismaSchemaAdjacent: boolean;
  prismaEngineAdjacent: boolean;
  prismaRuntimeLibraryPresent: boolean;
  prismaGeneratedPackagePresent: boolean;
  prismaExpectedEngineTarget: PrismaExpectedEngineTarget;
  prismaFailureClass: PrismaLayoutFailureClass;
  generatedClientDirectoryResolved: boolean;
  engineFileReadable: boolean;
  schemaFileReadable: boolean;
}

const EMPTY_ENGINE_IDENTITY: PrismaEngineIdentityProbe = {
  prismaEngineByteLength: undefined,
  prismaEngineSha256: undefined,
  prismaEngineReadable: false,
  prismaEngineExecutable: false,
  prismaEngineElfMagicValid: false,
  prismaEngineElfClass: 'UNKNOWN',
  prismaEngineArchitecture: 'UNKNOWN',
  prismaEngineIdentity: 'UNKNOWN',
};

const EMPTY_PROBE: PrismaLayoutProbeResult = {
  prismaClientIndexPresent: false,
  prismaSchemaAdjacent: false,
  prismaEngineAdjacent: false,
  prismaRuntimeLibraryPresent: false,
  prismaGeneratedPackagePresent: false,
  prismaExpectedEngineTarget: 'UNKNOWN',
  prismaFailureClass: 'UNKNOWN',
  generatedClientDirectoryResolved: false,
  engineFileReadable: false,
  schemaFileReadable: false,
  ...EMPTY_ENGINE_IDENTITY,
};

function safeExists(filePath: string): boolean {
  try {
    return fs.existsSync(filePath);
  } catch {
    return false;
  }
}

function safeReadable(filePath: string): boolean {
  try {
    fs.accessSync(filePath, fs.constants.R_OK);
    return true;
  } catch {
    return false;
  }
}

function safeExecutable(filePath: string): boolean {
  try {
    fs.accessSync(filePath, fs.constants.X_OK);
    return true;
  } catch {
    return false;
  }
}

function safeReadString(value: unknown, key: string): string | undefined {
  const candidate = safeReadProperty(value, key);
  return typeof candidate === 'string' && candidate.length > 0 ? candidate : undefined;
}

function isLowercaseSha256(value: string | undefined): value is string {
  return typeof value === 'string' && /^[a-f0-9]{64}$/.test(value);
}

/**
 * Derive generated client directory from an already-resolved traced runtime
 * path using only fixed relative segments (no cwd walk, no scanning).
 */
export function resolveGeneratedClientDirFromTracedRuntimePath(
  runtimePath: string | undefined,
): string | undefined {
  try {
    if (typeof runtimePath !== 'string' || runtimePath.length === 0) {
      return undefined;
    }
    return path.join(path.dirname(runtimePath), 'generated', 'client');
  } catch {
    return undefined;
  }
}

/**
 * Classify adjacent engine bytes against the known CI-tested RHEL engine.
 * Never throws; never returns paths or file contents.
 */
export function classifyPrismaEngineIdentity(
  identity: Omit<PrismaEngineIdentityProbe, 'prismaEngineIdentity'>,
): PrismaEngineIdentityClass {
  try {
    if (!identity.prismaEngineReadable) {
      return 'UNREADABLE';
    }
    if (!identity.prismaEngineElfMagicValid) {
      return 'INVALID_ELF';
    }
    if (identity.prismaEngineElfClass !== 'ELF64') {
      return 'INVALID_ELF';
    }
    if (identity.prismaEngineArchitecture !== 'X86_64') {
      return 'WRONG_ARCHITECTURE';
    }
    if (
      typeof identity.prismaEngineByteLength !== 'number' ||
      identity.prismaEngineByteLength !== EXPECTED_CI_ENGINE_BYTE_LENGTH
    ) {
      return 'SIZE_MISMATCH';
    }
    if (
      !isLowercaseSha256(identity.prismaEngineSha256) ||
      identity.prismaEngineSha256 !== EXPECTED_CI_ENGINE_SHA256
    ) {
      return 'HASH_MISMATCH';
    }
    return 'MATCHES_CI_ENGINE';
  } catch {
    return 'UNKNOWN';
  }
}

/**
 * Inspect only the fixed adjacent RHEL engine filename. Never throws.
 * Never stores or returns the path or raw file contents.
 */
export function inspectPrismaEngineIdentity(enginePath: string): PrismaEngineIdentityProbe {
  try {
    if (typeof enginePath !== 'string' || enginePath.length === 0) {
      return { ...EMPTY_ENGINE_IDENTITY, prismaEngineIdentity: 'UNREADABLE' };
    }

    const readable = safeReadable(enginePath);
    const executable = readable ? safeExecutable(enginePath) : false;
    if (!readable) {
      const probe = {
        ...EMPTY_ENGINE_IDENTITY,
        prismaEngineReadable: false,
        prismaEngineExecutable: false,
      };
      return { ...probe, prismaEngineIdentity: classifyPrismaEngineIdentity(probe) };
    }

    let byteLength: number | undefined;
    try {
      byteLength = fs.statSync(enginePath).size;
      if (!Number.isFinite(byteLength) || byteLength < 0 || byteLength > MAX_ENGINE_READ_BYTES) {
        const probe = {
          prismaEngineByteLength:
            typeof byteLength === 'number' && Number.isFinite(byteLength) && byteLength >= 0
              ? Math.floor(byteLength)
              : undefined,
          prismaEngineSha256: undefined,
          prismaEngineReadable: true,
          prismaEngineExecutable: executable,
          prismaEngineElfMagicValid: false,
          prismaEngineElfClass: 'UNKNOWN' as const,
          prismaEngineArchitecture: 'UNKNOWN' as const,
        };
        return { ...probe, prismaEngineIdentity: classifyPrismaEngineIdentity(probe) };
      }
      byteLength = Math.floor(byteLength);
    } catch {
      const probe = {
        ...EMPTY_ENGINE_IDENTITY,
        prismaEngineReadable: false,
        prismaEngineExecutable: false,
      };
      return { ...probe, prismaEngineIdentity: classifyPrismaEngineIdentity(probe) };
    }

    let contents: Buffer;
    try {
      contents = fs.readFileSync(enginePath);
    } catch {
      const probe = {
        prismaEngineByteLength: byteLength,
        prismaEngineSha256: undefined,
        prismaEngineReadable: false,
        prismaEngineExecutable: executable,
        prismaEngineElfMagicValid: false,
        prismaEngineElfClass: 'UNKNOWN' as const,
        prismaEngineArchitecture: 'UNKNOWN' as const,
      };
      return { ...probe, prismaEngineIdentity: classifyPrismaEngineIdentity(probe) };
    }

    if (contents.length !== byteLength) {
      byteLength = contents.length;
    }

    let sha256: string | undefined;
    try {
      sha256 = createHash('sha256').update(contents).digest('hex');
    } catch {
      sha256 = undefined;
    }

    const elfMagicValid =
      contents.length >= 4 && contents.subarray(0, 4).equals(ELF_MAGIC);
    let elfClass: PrismaEngineElfClass = 'UNKNOWN';
    let architecture: PrismaEngineArchitecture = 'UNKNOWN';

    if (elfMagicValid && contents.length >= 20) {
      const eiClass = contents[4];
      elfClass = eiClass === ELFCLASS64 ? 'ELF64' : 'OTHER';
      const eiData = contents[5];
      if (eiData === 1 || eiData === 2) {
        const eMachine =
          eiData === 1 ? contents.readUInt16LE(18) : contents.readUInt16BE(18);
        architecture = eMachine === EM_X86_64 ? 'X86_64' : 'OTHER';
      }
    } else if (!elfMagicValid) {
      elfClass = 'OTHER';
      architecture = 'OTHER';
    }

    const probe = {
      prismaEngineByteLength: byteLength,
      prismaEngineSha256: isLowercaseSha256(sha256) ? sha256 : undefined,
      prismaEngineReadable: true,
      prismaEngineExecutable: executable,
      prismaEngineElfMagicValid: elfMagicValid,
      prismaEngineElfClass: elfMagicValid ? elfClass : ('OTHER' as const),
      prismaEngineArchitecture: elfMagicValid ? architecture : ('OTHER' as const),
    };

    return {
      ...probe,
      prismaEngineIdentity: classifyPrismaEngineIdentity(probe),
    };
  } catch {
    return { ...EMPTY_ENGINE_IDENTITY, prismaEngineIdentity: 'UNKNOWN' };
  }
}

/**
 * Classify Prisma init failures using structured fields first, then fixed
 * internal message patterns. Never returns or logs the raw message.
 */
export function classifyPrismaLayoutFailure(
  error: unknown,
  layout: Pick<
    PrismaLayoutProbeResult,
    | 'generatedClientDirectoryResolved'
    | 'prismaClientIndexPresent'
    | 'prismaSchemaAdjacent'
    | 'prismaEngineAdjacent'
    | 'prismaRuntimeLibraryPresent'
  >,
): PrismaLayoutFailureClass {
  try {
    if (!layout.generatedClientDirectoryResolved) {
      return 'WRONG_CLIENT_DIRECTORY';
    }
    if (!layout.prismaClientIndexPresent || !layout.prismaRuntimeLibraryPresent) {
      return 'GENERATED_CLIENT_RUNTIME_MISSING';
    }

    const nodeCode = safeReadString(error, 'code');
    const message = safeReadString(error, 'message') ?? '';

    if (nodeCode === 'EACCES' || /permission denied|EACCES/i.test(message)) {
      return 'ENGINE_PERMISSION_DENIED';
    }
    if (nodeCode === 'MODULE_NOT_FOUND' || nodeCode === 'ERR_MODULE_NOT_FOUND') {
      return 'GENERATED_CLIENT_RUNTIME_MISSING';
    }

    const prismaCode = safeReadString(error, 'errorCode');
    if (prismaCode === 'P1012' || prismaCode === 'P1013') {
      return 'DATASOURCE_CONFIGURATION';
    }

    if (!layout.prismaSchemaAdjacent) {
      return 'SCHEMA_NOT_FOUND';
    }
    if (!layout.prismaEngineAdjacent) {
      return 'ENGINE_NOT_FOUND';
    }

    if (/could not locate the Query Engine/i.test(message)) {
      return 'ENGINE_NOT_FOUND';
    }
    if (/GLIBC|glibc version/i.test(message)) {
      return 'GLIBC_INCOMPATIBLE';
    }
    if (/libssl|libcrypto|OpenSSL/i.test(message)) {
      return 'OPENSSL_LIBRARY_MISSING';
    }
    if (/invalid ELF|wrong ELF class|ELFCLASS|wrong.*architecture|unsupported ELF/i.test(message)) {
      return 'ELF_ARCHITECTURE_MISMATCH';
    }
    if (
      /Module did not self-register|compiled against a different Node\.js|NODE_MODULE_VERSION|native module/i.test(
        message,
      )
    ) {
      return 'NATIVE_MODULE_REGISTRATION_FAILED';
    }
    if (/checksum|integrity check|hash mismatch/i.test(message)) {
      return 'ENGINE_CHECKSUM_MISMATCH';
    }
    if (/truncat|unexpected end of file|file too short/i.test(message)) {
      return 'ENGINE_FILE_TRUNCATED';
    }
    if (/panic|panicked at/i.test(message)) {
      return 'QUERY_ENGINE_PANIC';
    }
    if (
      nodeCode === 'ERR_DLOPEN_FAILED' ||
      /ERR_DLOPEN_FAILED|cannot open shared object|dlopen/i.test(message)
    ) {
      return 'ENGINE_DLOPEN_FAILED';
    }
    if (/schema\.prisma|Could not find.*schema|Unable to (?:open|load).*schema/i.test(message)) {
      return 'SCHEMA_NOT_FOUND';
    }
    if (
      /binaryTargets|not compatible with|Query Engine.*platform|wrong.*binary target/i.test(message)
    ) {
      return 'BINARY_TARGET_MISMATCH';
    }
    if (
      /Error validating datasource|invalid.*connection string|Error parsing connection|the URL must start with/i.test(
        message,
      )
    ) {
      return 'DATASOURCE_CONFIGURATION';
    }

    return 'UNKNOWN';
  } catch {
    return 'UNKNOWN';
  }
}

/**
 * Inspect fixed Prisma generated-client artifacts. Never throws.
 * Pass `generatedClientDir` derived from the traced runtime path (or a temp
 * directory in unit tests). Never imports the DB runtime bridge.
 */
export function inspectPrismaGeneratedClientLayout(
  error: unknown = undefined,
  generatedClientDir?: string,
): PrismaLayoutProbeResult {
  try {
    const clientDir =
      typeof generatedClientDir === 'string' && generatedClientDir.length > 0
        ? generatedClientDir
        : undefined;
    if (!clientDir) {
      return {
        ...EMPTY_PROBE,
        prismaFailureClass: classifyPrismaLayoutFailure(error, {
          generatedClientDirectoryResolved: false,
          prismaClientIndexPresent: false,
          prismaSchemaAdjacent: false,
          prismaEngineAdjacent: false,
          prismaRuntimeLibraryPresent: false,
        }),
        prismaEngineIdentity: 'UNREADABLE',
      };
    }

    const indexPath = path.join(clientDir, PRISMA_CLIENT_INDEX_FILENAME);
    const schemaPath = path.join(clientDir, PRISMA_SCHEMA_FILENAME);
    const enginePath = path.join(clientDir, RHEL_ENGINE_FILENAME);
    const libraryPath = path.join(clientDir, PRISMA_RUNTIME_LIBRARY_RELATIVE);
    const packagePath = path.join(clientDir, PRISMA_GENERATED_PACKAGE_FILENAME);

    const prismaClientIndexPresent = safeExists(indexPath);
    const prismaSchemaAdjacent = safeExists(schemaPath);
    const prismaEngineAdjacent = safeExists(enginePath);
    const prismaRuntimeLibraryPresent = safeExists(libraryPath);
    const prismaGeneratedPackagePresent = safeExists(packagePath);
    const engineFileReadable = prismaEngineAdjacent && safeReadable(enginePath);
    const schemaFileReadable = prismaSchemaAdjacent && safeReadable(schemaPath);

    const engineIdentity = prismaEngineAdjacent
      ? inspectPrismaEngineIdentity(enginePath)
      : {
          ...EMPTY_ENGINE_IDENTITY,
          prismaEngineIdentity: 'UNREADABLE' as const,
        };

    const layout = {
      generatedClientDirectoryResolved: true,
      prismaClientIndexPresent,
      prismaSchemaAdjacent,
      prismaEngineAdjacent,
      prismaRuntimeLibraryPresent,
    };

    return {
      prismaClientIndexPresent,
      prismaSchemaAdjacent,
      prismaEngineAdjacent,
      prismaRuntimeLibraryPresent,
      prismaGeneratedPackagePresent,
      prismaExpectedEngineTarget: prismaEngineAdjacent ? 'RHEL_OPENSSL_3' : 'UNKNOWN',
      prismaFailureClass: classifyPrismaLayoutFailure(error, layout),
      generatedClientDirectoryResolved: true,
      engineFileReadable,
      schemaFileReadable,
      ...engineIdentity,
    };
  } catch {
    return { ...EMPTY_PROBE };
  }
}

export function presentMissing(present: boolean): 'present' | 'missing' {
  return present ? 'present' : 'missing';
}

export function adjacentMissing(adjacent: boolean): 'adjacent' | 'missing' {
  return adjacent ? 'adjacent' : 'missing';
}

const PRISMA_LAYOUT_CAPTURE_CATEGORIES = new Set([
  'PRISMA_ENGINE_OR_CLIENT_LOAD',
  'PRISMA_CLIENT_INITIALIZATION',
]);

/**
 * True when failure category indicates Prisma client/engine init load issues.
 * Never inspects messages. Used to avoid filesystem probes for domain/auth errors.
 */
export function shouldCapturePrismaLayoutDiagnostics(error: unknown, category?: string): boolean {
  try {
    if (typeof category === 'string' && PRISMA_LAYOUT_CAPTURE_CATEGORIES.has(category)) {
      return true;
    }
    return safeReadString(error, 'name') === 'PrismaClientInitializationError';
  } catch {
    return false;
  }
}

/**
 * Capture allowlisted Prisma generated-client layout diagnostics into the
 * current request-scoped DB stage context. Never throws and never mutates error.
 */
export function capturePrismaLayoutFailureDiagnostics(error: unknown): void {
  try {
    const layout = inspectPrismaGeneratedClientLayout(
      error,
      resolveGeneratedClientDirFromTracedRuntimePath(getLastResolvedTracedRuntimePath()),
    );
    updateDbStageContext({
      prismaClientIndexPresent: layout.prismaClientIndexPresent,
      prismaSchemaAdjacent: layout.prismaSchemaAdjacent,
      prismaEngineAdjacent: layout.prismaEngineAdjacent,
      prismaRuntimeLibraryPresent: layout.prismaRuntimeLibraryPresent,
      prismaGeneratedPackagePresent: layout.prismaGeneratedPackagePresent,
      prismaExpectedEngineTarget: layout.prismaExpectedEngineTarget,
      prismaFailureClass: layout.prismaFailureClass,
      generatedClientDirectoryResolved: layout.generatedClientDirectoryResolved,
      engineFileReadable: layout.engineFileReadable,
      schemaFileReadable: layout.schemaFileReadable,
      prismaEngineByteLength: layout.prismaEngineByteLength,
      prismaEngineSha256: layout.prismaEngineSha256,
      prismaEngineReadable: layout.prismaEngineReadable,
      prismaEngineExecutable: layout.prismaEngineExecutable,
      prismaEngineElfMagicValid: layout.prismaEngineElfMagicValid,
      prismaEngineElfClass: layout.prismaEngineElfClass,
      prismaEngineArchitecture: layout.prismaEngineArchitecture,
      prismaEngineIdentity: layout.prismaEngineIdentity,
    });
  } catch {
    // Layout probe must never affect request handling.
  }
}
