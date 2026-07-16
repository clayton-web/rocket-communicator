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
  it(
    'generates TypeScript output',
    () => {
      execSync('pnpm generate', { cwd: root, stdio: 'pipe' });
      const generated = readFileSync(path.join(root, 'generated/typescript/schema.ts'), 'utf8');
      expect(generated).toContain('TaskSuggestion');
      expect(generated).toContain('TaskStatus');
    },
    120_000,
  );
});
