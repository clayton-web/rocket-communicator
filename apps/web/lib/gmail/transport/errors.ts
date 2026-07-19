import 'server-only';
import { createHash } from 'node:crypto';
import { MimeConstructionError } from './mime';

/**
 * A7.4 Gmail transport error taxonomy.
 *
 * Normalizes every Gmail send/attachment/MIME failure into a privacy-safe outcome carrying a
 * stable code, a category, a retryable flag, and a non-reversible fingerprint. Raw Google response
 * bodies, OAuth tokens, message bodies, recipient content, capability links, and attachment data
 * are NEVER included. Fields are shaped for later A7.3 persistence (failureCode / failureCategory /
 * failureFingerprint / retryable) without importing DB code.
 */

export type TransportFailureCode =
  | 'GMAIL_AUTHORIZATION_INVALID'
  | 'GMAIL_SEND_SCOPE_REQUIRED'
  | 'GMAIL_RATE_LIMITED'
  | 'GMAIL_PROVIDER_UNAVAILABLE'
  | 'GMAIL_NETWORK_ERROR'
  | 'GMAIL_AMBIGUOUS_SEND'
  | 'GMAIL_INVALID_RECIPIENT'
  | 'GMAIL_INVALID_MESSAGE'
  | 'GMAIL_SOURCE_MESSAGE_UNAVAILABLE'
  | 'GMAIL_ATTACHMENT_UNAVAILABLE'
  | 'GMAIL_MESSAGE_TOO_LARGE'
  | 'GMAIL_UNSUPPORTED_SOURCE_SHAPE'
  | 'GMAIL_CONFIGURATION_ERROR';

export type TransportFailureCategory =
  | 'authorization'
  | 'rate_limited'
  | 'provider_unavailable'
  | 'network'
  | 'ambiguous'
  | 'validation'
  | 'configuration'
  | 'not_found';

export interface TransportFailure {
  code: TransportFailureCode;
  category: TransportFailureCategory;
  /** Whether a later automatic retry of the same attempt is appropriate. */
  retryable: boolean;
  /**
   * When true, the transport cannot prove no email was sent (timeout after submission, connection
   * loss, unparseable success). Later orchestration must not blindly retry without reconciliation.
   */
  ambiguous: boolean;
  /** Safe, generic message. Never contains provider bodies, addresses, tokens, or content. */
  message: string;
  /** Deterministic, non-reversible fingerprint (code[:status]) for correlation/logs. */
  fingerprint: string;
}

interface TaxonomyEntry {
  category: TransportFailureCategory;
  retryable: boolean;
  ambiguous: boolean;
  message: string;
}

const TAXONOMY: Record<TransportFailureCode, TaxonomyEntry> = {
  GMAIL_AUTHORIZATION_INVALID: {
    category: 'authorization',
    retryable: false,
    ambiguous: false,
    message: 'Gmail authorization is missing or invalid.',
  },
  GMAIL_SEND_SCOPE_REQUIRED: {
    category: 'authorization',
    retryable: false,
    ambiguous: false,
    message: 'Gmail send scope has not been granted.',
  },
  GMAIL_RATE_LIMITED: {
    category: 'rate_limited',
    retryable: true,
    ambiguous: false,
    message: 'Gmail rate limit exceeded.',
  },
  GMAIL_PROVIDER_UNAVAILABLE: {
    category: 'provider_unavailable',
    retryable: true,
    ambiguous: false,
    message: 'Gmail is temporarily unavailable.',
  },
  GMAIL_NETWORK_ERROR: {
    category: 'network',
    retryable: true,
    ambiguous: false,
    message: 'Network failure contacting Gmail before the request was submitted.',
  },
  GMAIL_AMBIGUOUS_SEND: {
    category: 'ambiguous',
    retryable: false,
    ambiguous: true,
    message: 'Gmail send outcome is unknown; the message may or may not have been accepted.',
  },
  GMAIL_INVALID_RECIPIENT: {
    category: 'validation',
    retryable: false,
    ambiguous: false,
    message: 'Recipient address was rejected.',
  },
  GMAIL_INVALID_MESSAGE: {
    category: 'validation',
    retryable: false,
    ambiguous: false,
    message: 'The message was rejected as invalid.',
  },
  GMAIL_SOURCE_MESSAGE_UNAVAILABLE: {
    category: 'not_found',
    retryable: false,
    ambiguous: false,
    message: 'The Gmail source message could not be read.',
  },
  GMAIL_ATTACHMENT_UNAVAILABLE: {
    category: 'not_found',
    retryable: false,
    ambiguous: false,
    message: 'A required attachment could not be retrieved.',
  },
  GMAIL_MESSAGE_TOO_LARGE: {
    category: 'validation',
    retryable: false,
    ambiguous: false,
    message: 'The message exceeds the maximum allowed size.',
  },
  GMAIL_UNSUPPORTED_SOURCE_SHAPE: {
    category: 'validation',
    retryable: false,
    ambiguous: false,
    message: 'The source message structure is unsupported for forwarding.',
  },
  GMAIL_CONFIGURATION_ERROR: {
    category: 'configuration',
    retryable: false,
    ambiguous: false,
    message: 'Gmail transport is not configured correctly.',
  },
};

function fingerprintFor(code: TransportFailureCode, discriminator?: string | number): string {
  const input = discriminator == null ? code : `${code}:${discriminator}`;
  return createHash('sha256').update(input).digest('hex').slice(0, 16);
}

/** Build a normalized transport failure from a code, optionally salting the fingerprint. */
export function transportFailure(
  code: TransportFailureCode,
  discriminator?: string | number,
): TransportFailure {
  const entry = TAXONOMY[code];
  return {
    code,
    category: entry.category,
    retryable: entry.retryable,
    ambiguous: entry.ambiguous,
    message: entry.message,
    fingerprint: fingerprintFor(code, discriminator),
  };
}

/**
 * Map a Gmail HTTP status to a transport failure. The response body is NEVER read or embedded —
 * only the status code drives classification.
 */
export function classifyGmailSendHttpStatus(status: number): TransportFailure {
  if (status === 401) {
    return transportFailure('GMAIL_AUTHORIZATION_INVALID', status);
  }
  if (status === 403) {
    // 403 at send time (scope was validated pre-send) is treated as an authorization failure.
    return transportFailure('GMAIL_AUTHORIZATION_INVALID', status);
  }
  if (status === 429) {
    return transportFailure('GMAIL_RATE_LIMITED', status);
  }
  if (status === 413) {
    return transportFailure('GMAIL_MESSAGE_TOO_LARGE', status);
  }
  if (status === 400) {
    return transportFailure('GMAIL_INVALID_MESSAGE', status);
  }
  if (status === 404) {
    return transportFailure('GMAIL_SOURCE_MESSAGE_UNAVAILABLE', status);
  }
  if (status >= 500 && status <= 599) {
    return transportFailure('GMAIL_PROVIDER_UNAVAILABLE', status);
  }
  // Any other non-2xx is treated as an invalid-message rejection (non-retryable).
  return transportFailure('GMAIL_INVALID_MESSAGE', status);
}

/** Map a MIME construction error to a transport failure (validation-class, non-retryable). */
export function classifyMimeError(error: MimeConstructionError): TransportFailure {
  switch (error.code) {
    case 'INVALID_RECIPIENT':
      return transportFailure('GMAIL_INVALID_RECIPIENT', error.code);
    case 'MESSAGE_TOO_LARGE':
      return transportFailure('GMAIL_MESSAGE_TOO_LARGE', error.code);
    case 'INVALID_SENDER':
    case 'INVALID_HEADER':
    case 'INVALID_ATTACHMENT':
    case 'EMPTY_BODY':
    default:
      return transportFailure('GMAIL_INVALID_MESSAGE', error.code);
  }
}

export function isMimeConstructionError(error: unknown): error is MimeConstructionError {
  return error instanceof MimeConstructionError;
}
