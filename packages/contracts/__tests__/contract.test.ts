import { describe, expect, it } from 'vitest';
import { execSync } from 'node:child_process';
import { readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import Ajv from 'ajv';
import addFormats from 'ajv-formats';
import { parse as parseYaml } from 'yaml';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

describe('contracts package', () => {
  it('lints and bundles OpenAPI', () => {
    execSync('pnpm lint', { cwd: root, stdio: 'pipe' });
    execSync('pnpm bundle', { cwd: root, stdio: 'pipe' });
    const bundled = readFileSync(path.join(root, 'dist/openapi.bundled.yaml'), 'utf8');
    expect(bundled).toContain('/api/v1/session');
    expect(bundled).not.toContain('/health');
  });

  it('validates committed examples against bundled schemas', () => {
    execSync('pnpm bundle', { cwd: root, stdio: 'pipe' });
    const bundled = parseYaml(readFileSync(path.join(root, 'dist/openapi.bundled.yaml'), 'utf8'));
    const ajv = new Ajv({ strict: false, allErrors: true });
    addFormats(ajv);

    const schemas = bundled.components?.schemas ?? {};
    for (const [name, schema] of Object.entries(schemas)) {
      ajv.addSchema(schema as object, `#/components/schemas/${name}`);
    }

    const examplesDir = path.join(root, 'openapi/examples');
    const examples = readdirSync(examplesDir).filter((file) => file.endsWith('.json'));

    const suggestion = JSON.parse(
      readFileSync(path.join(examplesDir, 'task-suggestion-pending.json'), 'utf8'),
    );
    const validateSuggestion = ajv.getSchema('#/components/schemas/TaskSuggestion');
    expect(validateSuggestion?.(suggestion)).toBe(true);

    const complete = JSON.parse(
      readFileSync(path.join(examplesDir, 'task-complete-one-tap.json'), 'utf8'),
    );
    const validateComplete = ajv.getSchema('#/components/schemas/CompleteTaskRequest');
    expect(validateComplete?.(complete)).toBe(true);

    for (const file of examples.filter((name) => name.startsWith('error-'))) {
      const payload = JSON.parse(readFileSync(path.join(examplesDir, file), 'utf8'));
      const validateError = ajv.getSchema('#/components/schemas/ErrorResponse');
      expect(validateError?.(payload)).toBe(true);
    }

    expect(examples.length).toBeGreaterThanOrEqual(4);
  });

  // Full generate includes OpenAPI bundle, TypeScript, and Kotlin (Java) codegen.
  // CI annotations showed Vitest's default 5s timeout failing this step.
  it('generates TypeScript output', () => {
    execSync('pnpm generate', { cwd: root, stdio: 'pipe' });
    const generated = readFileSync(path.join(root, 'generated/typescript/schema.ts'), 'utf8');
    expect(generated).toContain('TaskSuggestion');
    expect(generated).toContain('TaskStatus');
    expect(generated).toContain('GmailConnection');
    expect(generated).toContain('GmailSyncRun');
    expect(generated).toContain('GmailConnectionStatus');
    expect(generated).toContain('HandoffTaskRequest');
    expect(generated).toContain('HandoffTaskResponse');
    expect(generated).toContain('CreateRecipientRequest');
    expect(generated).toContain('CAPABILITY_NO_LONGER_ACTIVE');
    expect(generated).toContain('handoff_confirmed_v1');
  }, 120_000);

  it('keeps Gmail public schemas free of token and ciphertext fields', () => {
    execSync('pnpm bundle', { cwd: root, stdio: 'pipe' });
    const bundled = parseYaml(readFileSync(path.join(root, 'dist/openapi.bundled.yaml'), 'utf8'));
    const schemas = bundled.components?.schemas ?? {};
    const gmailSchemas = [
      'GmailConnection',
      'GmailDisconnectResponse',
      'GmailSyncRun',
      'GmailSyncResponse',
      'GmailPollResponse',
    ];
    const forbiddenPropertyNames =
      /^(refreshToken|accessToken|encryptedRefreshToken|encryptedAccessToken|encryptionKeyVersion|clientSecret|pkceVerifier|codeVerifier)$/i;
    for (const name of gmailSchemas) {
      const schema = schemas[name] as { properties?: Record<string, unknown> } | undefined;
      for (const propertyName of Object.keys(schema?.properties ?? {})) {
        expect(propertyName).not.toMatch(forbiddenPropertyNames);
      }
    }
    expect(bundled.paths?.['/api/v1/gmail/connection']).toBeDefined();
    expect(bundled.paths?.['/api/v1/internal/gmail/poll']).toBeDefined();
    expect(bundled.paths?.['/api/v1/tasks/{taskId}/handoff']).toBeDefined();
    expect(bundled.paths?.['/api/v1/recipients']).toBeDefined();
    expect(bundled.paths?.['/api/v1/recipients/{recipientId}/deactivate']).toBeDefined();
    expect(bundled.paths?.['/api/v1/communication-events']).toBeUndefined();
    expect(schemas.AssignmentDeliveryStatus).toBeDefined();
    const deliveryDesc = JSON.stringify(schemas.AssignmentDeliveryStatus);
    expect(deliveryDesc).toMatch(/real delivery model/i);
    expect(deliveryDesc).not.toMatch(/Placeholder for assignment email delivery tracking/i);
    expect(deliveryDesc).not.toMatch(/implementation deferred/i);
    expect(deliveryDesc).toMatch(/pending|sent|failed/);
    expect(schemas.HandoffTaskResponse).toBeDefined();
    const handoffProps = (schemas.HandoffTaskResponse as { properties?: Record<string, unknown> })
      .properties;
    expect(handoffProps?.token).toBeUndefined();
    expect(handoffProps?.capabilityId).toBeDefined();
    expect(schemas.ErrorCode).toBeDefined();
    const errorEnum = (schemas.ErrorCode as { enum?: string[] }).enum ?? [];
    expect(errorEnum).toContain('CAPABILITY_NO_LONGER_ACTIVE');
    expect(errorEnum).toContain('GMAIL_SEND_SCOPE_REQUIRED');
    expect(errorEnum).toContain('HANDOFF_DELIVERY_FAILED');
    const errorDesc = (schemas.ErrorCode as { description?: string }).description ?? '';
    expect(errorDesc).toMatch(/superseded/i);
    expect(errorDesc).toMatch(/UNAUTHORIZED/);
    expect(errorDesc).toMatch(/[Mm]anual/);
    expect(errorDesc).not.toMatch(/superseded\/revoked/i);
    expect(errorDesc).not.toMatch(/revoked\/superseded/i);
    const capabilityNoLongerActive = bundled.components?.responses?.CapabilityNoLongerActive as
      { description?: string } | undefined;
    const responseDesc = capabilityNoLongerActive?.description ?? '';
    expect(responseDesc).toMatch(/superseded/i);
    expect(responseDesc).toMatch(/UNAUTHORIZED/);
    expect(responseDesc).toMatch(/[Mm]anual/);
    expect(responseDesc).not.toMatch(/revoked\/superseded/i);
    expect(responseDesc).not.toMatch(/superseded\/revoked/i);
    const capabilityStatusDesc =
      (schemas.CapabilityStatus as { description?: string } | undefined)?.description ?? '';
    expect(capabilityStatusDesc).toMatch(/supersession/i);
    expect(capabilityStatusDesc).not.toMatch(/revoked\/superseded/i);
    expect(bundled.components?.parameters?.IdempotencyKey).toBeDefined();
    expect(schemas.GmailPollRequest).toBeUndefined();
    const pollPath = bundled.paths?.['/api/v1/internal/gmail/poll'];
    expect(pollPath?.get?.security).toEqual([{ InternalCronBearer: [] }]);
    expect(pollPath?.post?.security).toEqual([{ InternalCronBearer: [] }]);
    expect(bundled.components?.securitySchemes?.InternalCronBearer).toBeDefined();
  });

  it('has no stale generated Kotlin artifacts outside the generator manifest', () => {
    execSync('node scripts/cleanup-kotlin-orphans.mjs --check', { cwd: root, stdio: 'pipe' });
    const kotlinDocs = path.join(root, 'generated/kotlin/docs');
    expect(readFileSync(path.join(kotlinDocs, 'AuthenticatedRole.md'), 'utf8')).toContain('owner');
    expect(readFileSync(path.join(kotlinDocs, 'ReturnTaskToOwnerRequest.md'), 'utf8')).toContain(
      'ReturnTaskToOwnerRequest',
    );
  });
});
