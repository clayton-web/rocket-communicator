/**
 * Temporary allowlisted Prisma generated-client layout diagnostics.
 * Reports only fixed booleans/enums — never paths, messages, stacks, or URLs.
 */
import fs from 'node:fs';
import path from 'node:path';
import { safeReadProperty } from '@/lib/db/diagnostics';

export const RHEL_ENGINE_FILENAME = 'libquery_engine-rhel-openssl-3.0.x.so.node' as const;
export const PRISMA_SCHEMA_FILENAME = 'schema.prisma' as const;
export const PRISMA_CLIENT_INDEX_FILENAME = 'index.js' as const;
export const PRISMA_RUNTIME_LIBRARY_RELATIVE = path.join('runtime', 'library.js');
export const PRISMA_GENERATED_PACKAGE_FILENAME = 'package.json' as const;

export type PrismaExpectedEngineTarget = 'RHEL_OPENSSL_3' | 'OTHER' | 'UNKNOWN';

export type PrismaLayoutFailureClass =
  | 'ENGINE_NOT_FOUND'
  | 'ENGINE_LOAD_FAILED'
  | 'SCHEMA_NOT_FOUND'
  | 'GENERATED_CLIENT_RUNTIME_MISSING'
  | 'WRONG_CLIENT_DIRECTORY'
  | 'BINARY_TARGET_MISMATCH'
  | 'DATASOURCE_CONFIGURATION'
  | 'OTHER'
  | 'UNKNOWN';

export interface PrismaLayoutProbeResult {
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

function safeReadString(value: unknown, key: string): string | undefined {
  const candidate = safeReadProperty(value, key);
  return typeof candidate === 'string' && candidate.length > 0 ? candidate : undefined;
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
    if (nodeCode === 'ERR_DLOPEN_FAILED') {
      return 'ENGINE_LOAD_FAILED';
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

    const message = safeReadString(error, 'message') ?? '';
    if (/could not locate the Query Engine/i.test(message)) {
      return 'ENGINE_NOT_FOUND';
    }
    if (
      /ERR_DLOPEN_FAILED|invalid ELF|wrong ELF class|cannot open shared object|libssl|OpenSSL/i.test(
        message,
      )
    ) {
      return 'ENGINE_LOAD_FAILED';
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
