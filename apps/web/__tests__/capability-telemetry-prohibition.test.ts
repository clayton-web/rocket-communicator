// @vitest-environment node
import { describe, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  assertNoCapabilitySecretInDiagnostic,
  emitOperationalLog,
  looksLikeRawCapabilityPath,
  toSafeRouteTemplate,
} from '@/lib/observability';
import { redactCapabilitySecrets, assertNoRawCapabilityToken } from '@/lib/capability/redact';

/**
 * Structural / automated proof for D114: capability secrets must not reach diagnostics.
 * No client telemetry is authorized on `/c/[token]` (P1.1).
 */
describe('P1.1 capability-route diagnostic protection (D114)', () => {
  const sampleToken = 'AbCdEfGhIjKlMnOpQrStUvWxYz0123456789_-xx';

  it('toSafeRouteTemplate removes token from browser and API paths', () => {
    expect(toSafeRouteTemplate(`/c/${sampleToken}`)).toBe('/c/[token]');
    expect(toSafeRouteTemplate(`/api/v1/capabilities/${sampleToken}/tasks/task_1/complete`)).toBe(
      '/api/v1/capabilities/[token]/tasks/[taskId]/complete',
    );
  });

  it('adversarial inputs cannot retain the raw token in templates', () => {
    const encodedish = `/c/${sampleToken}/`;
    const absolute = `https://app.example/c/${sampleToken}?next=/tasks`;
    const nested = `failed while opening https://app.example/c/${sampleToken}`;
    expect(toSafeRouteTemplate(encodedish)).toBe('/c/[token]/');
    expect(toSafeRouteTemplate(absolute)).toBe('/c/[token]');
    // Nested absolute strings are not pathnames; scrubber still replaces /c/{segment}.
    expect(toSafeRouteTemplate(nested)).not.toContain(sampleToken);
    expect(looksLikeRawCapabilityPath(toSafeRouteTemplate(nested))).toBe(false);
  });

  it('emitOperationalLog refuses to retain a raw /c/{token} path', () => {
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const infoSpy = vi.spyOn(console, 'info').mockImplementation(() => undefined);
    try {
      const record = emitOperationalLog({
        event: 'operational_failure',
        level: 'error',
        routeTemplate: `/c/${sampleToken}`,
        outcome: 'error',
      });
      expect(record?.routeTemplate).toBe('/c/[token]');
      assertNoCapabilitySecretInDiagnostic(record, 'emitOperationalLog');
      for (const call of [...errorSpy.mock.calls, ...infoSpy.mock.calls]) {
        const line = String(call[0] ?? '');
        expect(line.includes(sampleToken)).toBe(false);
        expect(looksLikeRawCapabilityPath(line)).toBe(false);
      }
    } finally {
      errorSpy.mockRestore();
      infoSpy.mockRestore();
    }
  });

  it('redactCapabilitySecrets and assertNoRawCapabilityToken remain effective', () => {
    const dirty = `opened /c/${sampleToken} then failed`;
    const clean = redactCapabilitySecrets(dirty);
    expect(clean.includes(sampleToken)).toBe(false);
    expect(() => assertNoRawCapabilityToken({ note: dirty }, sampleToken, 'test payload')).toThrow(
      /Raw capability token/,
    );
    expect(() =>
      assertNoRawCapabilityToken({ note: clean }, sampleToken, 'test payload'),
    ).not.toThrow();
  });

  it('capability page and panel source do not import analytics or client telemetry SDKs', () => {
    const root = join(__dirname, '..');
    const files = [
      'app/c/[token]/page.tsx',
      'app/c/[token]/recipient-capability-panel.tsx',
      'lib/capability/page-load.ts',
    ];
    const forbidden = [
      'posthog',
      'sentry',
      'datadog',
      '@vercel/analytics',
      'mixpanel',
      'logrocket',
      'fullstory',
      'segment',
    ];
    for (const relative of files) {
      const source = readFileSync(join(root, relative), 'utf8');
      for (const name of forbidden) {
        expect(source.toLowerCase()).not.toContain(name);
      }
      // No client telemetry wiring on the capability surface.
      expect(source).not.toMatch(/gtag\(|ga\(/);
    }
  });

  it('proxy keeps no-store / no-referrer / noindex for /c/ routes', () => {
    const source = readFileSync(join(__dirname, '../proxy.ts'), 'utf8');
    expect(source).toContain("CAPABILITY_PAGE_PREFIX = '/c/'");
    expect(source).toContain('pathname.startsWith(CAPABILITY_PAGE_PREFIX)');
    expect(source).toContain('no-store');
    expect(source).toContain('no-referrer');
    expect(source).toContain('noindex');
  });
});
