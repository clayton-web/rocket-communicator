import { DEFAULT_CAPABILITY_TTL_MS, MS_PER_DAY } from '@aicaa/domain';
import { CapabilityTokenError, capabilityTokenError } from './errors';

export interface CapabilityTokenConfig {
  /** Required HMAC pepper for token lookup hashes (server-only). */
  pepper: string;
  /** Injected TTL in milliseconds (D055). */
  ttlMs: number;
  /** Application base URL for one-time capability URL construction. */
  appUrl: string;
}

/** Minimum allowed TTL: 1 minute. */
export const MIN_CAPABILITY_TTL_MS = 60_000;

/** Maximum allowed TTL: 90 days (guards against unbounded links). */
export const MAX_CAPABILITY_TTL_MS = 90 * MS_PER_DAY;

/** Documented minimum pepper length (high-entropy secret). */
export const MIN_CAPABILITY_TOKEN_PEPPER_LENGTH = 32;

function requireConfiguredEnv(value: string | undefined, name: string): string {
  const trimmed = value?.trim();
  if (!trimmed) {
    throw capabilityTokenError('MISSING_CONFIGURATION', `${name} is required.`, {
      configKey: name,
    });
  }
  return trimmed;
}

function normalizeAppUrl(appUrl: string): string {
  return appUrl.replace(/\/$/, '');
}

export function parseCapabilityTtlMs(raw: string, source = 'CAPABILITY_TTL_MS'): number {
  if (!/^\d+$/.test(raw.trim())) {
    throw capabilityTokenError(
      'INVALID_TTL_CONFIGURATION',
      `${source} must be a positive integer number of milliseconds.`,
      { configKey: source },
    );
  }
  const ttlMs = Number.parseInt(raw.trim(), 10);
  return assertValidCapabilityTtlMs(ttlMs, source);
}

export function assertValidCapabilityTtlMs(ttlMs: number, source = 'ttlMs'): number {
  if (!Number.isInteger(ttlMs) || ttlMs <= 0) {
    throw capabilityTokenError(
      'INVALID_TTL_CONFIGURATION',
      `${source} must be a positive integer duration in milliseconds.`,
      { configKey: source },
    );
  }
  if (ttlMs < MIN_CAPABILITY_TTL_MS) {
    throw capabilityTokenError(
      'INVALID_TTL_CONFIGURATION',
      `${source} must be at least ${MIN_CAPABILITY_TTL_MS} ms.`,
      { configKey: source, minMs: MIN_CAPABILITY_TTL_MS },
    );
  }
  if (ttlMs > MAX_CAPABILITY_TTL_MS) {
    throw capabilityTokenError(
      'INVALID_TTL_CONFIGURATION',
      `${source} must not exceed ${MAX_CAPABILITY_TTL_MS} ms.`,
      { configKey: source, maxMs: MAX_CAPABILITY_TTL_MS },
    );
  }
  return ttlMs;
}

export function assertValidCapabilityPepper(
  pepper: string,
  source = 'CAPABILITY_TOKEN_PEPPER',
): string {
  if (pepper.length < MIN_CAPABILITY_TOKEN_PEPPER_LENGTH) {
    throw capabilityTokenError(
      'MISSING_CONFIGURATION',
      `${source} must be at least ${MIN_CAPABILITY_TOKEN_PEPPER_LENGTH} characters.`,
      { configKey: source },
    );
  }
  return pepper;
}

/**
 * Load required server-only capability token configuration.
 * Never expose `pepper` through public/browser configuration.
 */
export function getCapabilityTokenConfig(
  env: NodeJS.ProcessEnv = process.env,
): CapabilityTokenConfig {
  try {
    const pepper = assertValidCapabilityPepper(
      requireConfiguredEnv(env.CAPABILITY_TOKEN_PEPPER, 'CAPABILITY_TOKEN_PEPPER'),
    );
    const ttlRaw = requireConfiguredEnv(env.CAPABILITY_TTL_MS, 'CAPABILITY_TTL_MS');
    const ttlMs = parseCapabilityTtlMs(ttlRaw);
    const appUrl = normalizeAppUrl(
      requireConfiguredEnv(env.NEXT_PUBLIC_APP_URL, 'NEXT_PUBLIC_APP_URL'),
    );
    return { pepper, ttlMs, appUrl };
  } catch (error) {
    if (error instanceof CapabilityTokenError) {
      throw error;
    }
    throw error;
  }
}

/** Documented D055 seven-day default for callers that inject TTL explicitly. */
export const DOCUMENTED_DEFAULT_CAPABILITY_TTL_MS = DEFAULT_CAPABILITY_TTL_MS;
