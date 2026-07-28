import { redactCapabilitySecrets } from '@/lib/capability/redact';
import { getRequestContext } from './request-context';
import { toSafeRouteTemplate } from './route-template';

export type OperationalLogLevel = 'debug' | 'info' | 'warn' | 'error';

/**
 * Vendor-neutral structured operational diagnostic record (P1.1 / D113–D115).
 * Measurement only — never a business record, audit row, or learning signal.
 */
export interface OperationalLogRecord {
  event: string;
  level: OperationalLogLevel;
  timestamp: string;
  requestId?: string;
  correlationId?: string | null;
  /** Safe route template — never a raw capability path. */
  routeTemplate?: string;
  operation?: string;
  category?: string;
  durationMs?: number;
  outcome?: 'ok' | 'error' | 'rejected';
}

export type OperationalLogSink = (line: string, level: OperationalLogLevel) => void;

let sink: OperationalLogSink = defaultSink;

function defaultSink(line: string, level: OperationalLogLevel): void {
  // Production: map severity to console channel so platform log ingestion can filter.
  if (level === 'error' || level === 'warn') {
    console.error(line);
  } else {
    console.info(line);
  }
}

/** Test-only: replace the log sink. All levels must flow through the sink. */
export function setOperationalLogSinkForTests(next: OperationalLogSink | null): void {
  sink = next ?? defaultSink;
}

function sanitizeDurationMs(value: number | undefined): number | undefined {
  if (value === undefined) {
    return undefined;
  }
  if (!Number.isFinite(value) || value < 0) {
    return 0;
  }
  return value;
}

/**
 * Emit one privacy-safe structured JSON diagnostic line.
 * Scrubs capability secrets from string fields before write.
 * Never throws. Allowlisted fields only — no arbitrary metadata bag (D114).
 */
export function emitOperationalLog(
  partial: Omit<OperationalLogRecord, 'timestamp'> & { timestamp?: string },
): OperationalLogRecord | undefined {
  try {
    const ctx = getRequestContext();
    const record: OperationalLogRecord = {
      event: partial.event,
      level: partial.level,
      timestamp: partial.timestamp ?? new Date().toISOString(),
      requestId: partial.requestId ?? ctx?.requestId,
      correlationId:
        partial.correlationId !== undefined ? partial.correlationId : (ctx?.correlationId ?? null),
      routeTemplate: sanitizeRoute(partial.routeTemplate ?? ctx?.routeTemplate),
      operation: partial.operation ?? ctx?.operation,
      category: partial.category,
      durationMs: sanitizeDurationMs(partial.durationMs),
      outcome: partial.outcome,
    };

    const serialized = JSON.stringify(record, (_key, value) => {
      if (typeof value === 'string') {
        return redactCapabilitySecrets(value);
      }
      return value;
    });

    // Defense in depth: refuse to emit if a raw /c/ token path survived.
    if (/\/c\/[A-Za-z0-9_-]{20,}/.test(serialized)) {
      writeLine(
        JSON.stringify({
          event: 'operational_log_suppressed',
          level: 'error',
          timestamp: new Date().toISOString(),
          category: 'CAPABILITY_SECRET_GUARD',
          requestId: record.requestId,
        }),
        'error',
      );
      return undefined;
    }

    writeLine(serialized, record.level);
    return record;
  } catch {
    return undefined;
  }
}

function writeLine(line: string, level: OperationalLogLevel): void {
  try {
    sink(line, level);
  } catch {
    // Never let diagnostics break the business request.
  }
}

function sanitizeRoute(route: string | undefined): string | undefined {
  if (!route) {
    return undefined;
  }
  return toSafeRouteTemplate(route);
}
