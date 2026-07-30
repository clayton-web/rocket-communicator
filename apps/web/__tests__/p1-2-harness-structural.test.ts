// @vitest-environment node
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  assertLocalDatabaseUrl,
  appServerEnv,
  E2E_APP_URL,
  E2E_AUTH_URL,
  E2E_DATABASE_URL,
} from '@/e2e/config/e2e-env';
import { assertLocalClusterTarget } from '@/e2e/config/local-db-guard.mjs';
import { redactCapabilityPaths, REDACTED_CAPABILITY } from '@/e2e/support/artifact-safety';

/**
 * P1.2 structural guarantees for the browser verification harness (D119).
 *
 * These run in the ordinary unit suite so the harness's security properties are enforced on
 * every change, not only when a browser run happens to execute.
 */

const webRoot = path.resolve(__dirname, '..');
const e2eRoot = path.join(webRoot, 'e2e');

function readAllFiles(dir: string, extensions: string[]): { file: string; contents: string }[] {
  if (!fs.existsSync(dir)) {
    return [];
  }
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      return readAllFiles(full, extensions);
    }
    if (!extensions.some((extension) => entry.name.endsWith(extension))) {
      return [];
    }
    return [{ file: path.relative(webRoot, full), contents: fs.readFileSync(full, 'utf8') }];
  });
}

describe('P1.2 harness is impossible to activate in production', () => {
  it('no application source imports the harness', () => {
    const appSources = [
      ...readAllFiles(path.join(webRoot, 'app'), ['.ts', '.tsx']),
      ...readAllFiles(path.join(webRoot, 'lib'), ['.ts', '.tsx']),
      { file: 'proxy.ts', contents: fs.readFileSync(path.join(webRoot, 'proxy.ts'), 'utf8') },
    ];

    const offenders = appSources.filter(
      ({ contents }) => /from\s+['"][^'"]*e2e\//.test(contents) || contents.includes('auth-double'),
    );

    expect(offenders.map(({ file }) => file)).toEqual([]);
  });

  it('the auth double binds to loopback only and issues nothing usable elsewhere', () => {
    const double = fs.readFileSync(path.join(e2eRoot, 'support/auth-double/server.mjs'), 'utf8');

    expect(double).toContain("server.listen(PORT, '127.0.0.1'");
    // Tokens are explicitly unsigned and locally scoped.
    expect(double).toContain("alg: 'none'");
    expect(double).toContain('e2e-local-not-a-signature');
    // The double never reaches a real provider.
    expect(double).not.toMatch(/https:\/\/(accounts\.google|[a-z0-9-]+\.supabase\.co)/);
  });

  it('harness targets are loopback addresses, never production hosts', () => {
    expect(E2E_APP_URL).toMatch(/^http:\/\/127\.0\.0\.1:\d+$/);
    expect(E2E_AUTH_URL).toMatch(/^http:\/\/127\.0\.0\.1:\d+$/);

    const env = appServerEnv();
    expect(env.NEXT_PUBLIC_SUPABASE_URL).toBe(E2E_AUTH_URL);
    expect(env.NEXT_PUBLIC_APP_URL).toBe(E2E_APP_URL);
    expect(env.DATABASE_URL).toBe(E2E_DATABASE_URL);
    // A disposable organization scope, never the production organization id.
    expect(env.OWNER_ORGANIZATION_ID).toBe('org_e2e_local');
    expect(env.OWNER_ORGANIZATION_ID).not.toBe('axford');
  });

  it('accepts only genuinely loopback database URLs', () => {
    expect(() => assertLocalDatabaseUrl(E2E_DATABASE_URL)).not.toThrow();

    for (const safe of [
      'postgresql://postgres@127.0.0.1:55432/aicaa_e2e?schema=public',
      'postgresql://postgres@localhost:55432/aicaa_e2e',
      'postgres://postgres@[::1]:55432/aicaa_e2e',
      'postgresql://postgres@LOCALHOST:55432/aicaa_e2e',
    ]) {
      expect(() => assertLocalDatabaseUrl(safe), safe).not.toThrow();
    }
  });

  it('refuses every adversarial database URL form', () => {
    const unsafe = [
      // Managed/production hosts.
      'postgresql://user:pw@aws-1-us-west-2.pooler.supabase.com:5432/postgres',
      'postgresql://user:pw@db.example.supabase.co:5432/postgres',
      'postgresql://user:pw@prod.abcdef.us-east-1.rds.amazonaws.com:5432/app',
      'postgresql://user:pw@10.0.0.5:5432/app',
      // Deceptive hostnames that merely start with a loopback literal.
      'postgresql://postgres@127.0.0.1.example.com/db',
      'postgresql://postgres@localhost.evil.com/db',
      // User-info bypass: WHATWG parsing makes the LAST "@" segment the real host, so a
      // regex looking for "@127.0.0.1" anywhere in the string would wrongly accept this.
      'postgresql://u@127.0.0.1:5432@evil.example.com/db',
      // Connection-target overrides that re-point a loopback URL elsewhere.
      'postgresql://postgres@127.0.0.1:55432/db?host=prod.internal',
      'postgresql://postgres@127.0.0.1:55432/db?hostaddr=10.0.0.9',
      'postgresql://postgres@127.0.0.1:55432/db?socket=/var/run/other',
      // Percent-encoded host: never provably local, so it must fail closed.
      'postgresql://postgres@%31%32%37.0.0.1/db',
      // Wrong scheme, unparseable, and empty inputs all fail closed.
      'mysql://postgres@127.0.0.1:55432/db',
      'not a url at all',
      '',
      '   ',
    ];

    for (const url of unsafe) {
      expect(() => assertLocalDatabaseUrl(url), url).toThrow(/refuses to use this database/);
    }
    // A missing value must fail closed rather than pass through.
    expect(() => assertLocalDatabaseUrl(undefined as unknown as string)).toThrow(
      /refuses to use this database/,
    );
  });

  it('refuses destructive cluster targets that environment overrides could redirect', () => {
    const safe = {
      socketDir: '/tmp',
      database: 'aicaa_e2e',
      port: '55432',
      pgData: '/Users/someone/.aicaa-e2e-pg',
    };
    expect(() => assertLocalClusterTarget(safe)).not.toThrow();

    const unsafe = [
      // `dropdb -h` treats a non-absolute value as a TCP hostname.
      { ...safe, socketDir: 'db.example.com' },
      { ...safe, socketDir: '' },
      // Only the disposable test database may be dropped.
      { ...safe, database: 'postgres' },
      { ...safe, database: 'production' },
      // Never the conventional default port, where a real cluster usually lives.
      { ...safe, port: '5432' },
      { ...safe, port: 'not-a-port' },
      // Never an unrelated data directory, which `pg_ctl stop` would shut down.
      { ...safe, pgData: '/usr/local/var/postgres' },
      { ...safe, pgData: 'relative/.aicaa-e2e-pg' },
    ];

    for (const target of unsafe) {
      expect(() => assertLocalClusterTarget(target), JSON.stringify(target)).toThrow(
        /P1\.2 harness refuses/,
      );
    }
  });

  it('keeps one shared guard implementation instead of drifting copies', () => {
    const scripts = readAllFiles(path.join(e2eRoot, 'scripts'), ['.mjs']);
    const destructiveOrMutating = scripts.filter(
      ({ contents }) => contents.includes('dropdb') || contents.includes('createPrismaClient'),
    );
    expect(destructiveOrMutating.length).toBeGreaterThan(0);

    for (const script of destructiveOrMutating) {
      expect(script.contents, `${script.file} must import the shared guard`).toMatch(
        /from '\.\.\/config\/local-db-guard\.mjs'/,
      );
      // A local re-implementation is how the two copies drifted before.
      expect(script.contents, `${script.file} must not redefine the guard`).not.toMatch(
        /function assertLocal(DatabaseUrl|ClusterTarget)/,
      );
    }
  });
});

describe('P1.2 capability-secret controls', () => {
  it('every spec that opens a capability link disables trace and screenshot capture', () => {
    const specs = readAllFiles(path.join(e2eRoot, 'specs'), ['.spec.ts']);
    expect(specs.length).toBeGreaterThan(0);

    const usesCapabilityLink = specs.filter(
      ({ contents }) => contents.includes('capabilityPath') || contents.includes('/c/'),
    );
    expect(usesCapabilityLink.length).toBeGreaterThan(0);

    for (const spec of usesCapabilityLink) {
      expect(spec.contents, `${spec.file} must disable trace capture`).toMatch(
        /test\.use\(\{[^}]*trace:\s*'off'/s,
      );
      expect(spec.contents, `${spec.file} must disable screenshot capture`).toMatch(
        /test\.use\(\{[^}]*screenshot:\s*'off'/s,
      );
    }
  });

  it('no spec embeds a raw capability token in a title or literal', () => {
    const specs = readAllFiles(path.join(e2eRoot, 'specs'), ['.spec.ts']);

    for (const spec of specs) {
      // Placeholder tokens are built from repeated characters, never real base64url secrets.
      const suspicious = spec.contents.match(/['"][A-Za-z0-9_-]{40,}['"]/g) ?? [];
      expect(suspicious, `${spec.file} must not contain a token-shaped literal`).toEqual([]);
    }
  });

  it('video and trace capture are disabled globally so no unverifiable archive is retained', () => {
    const config = fs.readFileSync(path.join(webRoot, 'playwright.config.ts'), 'utf8');

    expect(config).toMatch(/video:\s*'off'/);
    expect(config).toMatch(/screenshot:\s*'only-on-failure'/);
    // A trace is a zip: a secret inside one cannot be verified without decompressing it.
    expect(config).toMatch(/trace:\s*'off'/);
    // Application log capture is redacted inside an owned launcher so `next` cannot outlive
    // the Playwright webServer process (a shell pipe orphans it and holds the app port).
    expect(config).toContain('run-web-server.mjs');
    // HTML reporter embeds a base64 zip that can retain capability URLs; default is list only.
    expect(config).toMatch(/reporter:\s*\[\s*\['list'\]\s*\]/);
    expect(config).not.toMatch(/\['html'/);
  });

  it('the capability-secret sweep runs from global teardown, so a failing run cannot skip it', () => {
    const config = fs.readFileSync(path.join(webRoot, 'playwright.config.ts'), 'utf8');
    expect(config).toContain("globalTeardown: './e2e/global-teardown.ts'");

    const teardown = fs.readFileSync(path.join(e2eRoot, 'global-teardown.ts'), 'utf8');
    expect(teardown).toContain('verify-artifact-safety.mjs');
    // Teardown must fail the run rather than only warn.
    expect(teardown).toMatch(/throw new Error/);

    // The gate must not depend on a script chained after a *successful* `playwright test`.
    const pkg = JSON.parse(fs.readFileSync(path.join(webRoot, 'package.json'), 'utf8')) as {
      scripts: Record<string, string>;
    };
    expect(pkg.scripts.e2e).not.toContain('&& pnpm e2e:verify-artifacts');

    // Reporters finish after global teardown, so the HTML report is written last and would
    // escape a teardown-only gate. Every documented entry point therefore goes through the
    // runner, which sweeps again after Playwright exits.
    for (const script of ['e2e', 'e2e:only', 'e2e:headed', 'e2e:report:generate'] as const) {
      expect(pkg.scripts[script], `${script} must run through the harness runner`).toContain(
        'run-harness.mjs',
      );
    }
    const runner = fs.readFileSync(path.join(e2eRoot, 'scripts/run-harness.mjs'), 'utf8');
    expect(runner).toContain('verify-artifact-safety.mjs');
    // The sweep must not be conditional on the test run succeeding.
    expect(runner).not.toMatch(/if\s*\(\s*testRun\.status[^)]*\)\s*{\s*\n\s*const sweep/);
  });

  it('no spec passes a raw capability token as an expected assertion value', () => {
    const specs = readAllFiles(path.join(e2eRoot, 'specs'), ['.spec.ts']);

    // Playwright writes failure messages into `error-context.md` regardless of trace and
    // screenshot settings, so a token used as an expected value leaks on failure. Comparing
    // booleans keeps the secret out of the message.
    for (const spec of specs) {
      expect(
        spec.contents,
        `${spec.file} must not pass a raw token to a matcher; compare a boolean instead`,
      ).not.toMatch(/\.(toContain|toBe|toMatch|toEqual)\([^)]*capability\.token/);
    }
  });

  it('every skipped browser case is a static project exclusion, never a data-dependent skip', () => {
    const specs = readAllFiles(path.join(e2eRoot, 'specs'), ['.spec.ts']);

    for (const spec of specs) {
      const skips = spec.contents.match(/test\.skip\([\s\S]{0,120}/g) ?? [];
      for (const skip of skips) {
        // A skip conditioned on database contents makes the result depend on execution
        // order and silently asserts nothing. Only project-name exclusions are allowed.
        expect(skip, `${spec.file} has a skip that is not a static project exclusion`).toMatch(
          /testInfo\.project\.name/,
        );
      }
    }
  });

  it('redacts every capability path shape from any diagnostic string', () => {
    const token = 'Z'.repeat(43);

    expect(redactCapabilityPaths(`GET /c/${token} 200`)).toBe(`GET ${REDACTED_CAPABILITY} 200`);
    expect(redactCapabilityPaths(`visit /c/${token}?x=1`)).not.toContain(token);
    // The Recipient API path carries the token too, and a failed-request diagnostic would
    // otherwise record it verbatim.
    expect(
      redactCapabilityPaths(`POST /api/v1/capabilities/${token}/tasks/task_1/notes failed`),
    ).toBe('POST /api/v1/capabilities/[redacted]/tasks/task_1/notes failed');
    expect(redactCapabilityPaths('GET /tasks 200')).toBe('GET /tasks 200');
    // Approved templates must survive untouched so the sweep cannot confuse them with secrets.
    expect(redactCapabilityPaths('routeTemplate:/c/[token]')).toBe('routeTemplate:/c/[token]');
    expect(redactCapabilityPaths('/c/[redacted]')).toBe('/c/[redacted]');
  });

  /**
   * Executes the real sweep against a throwaway artifact tree. Proves the gate actually
   * fires rather than merely containing the right words.
   */
  function runSweep(seed: (dir: string) => void): { status: number; output: string } {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'p12-sweep-'));
    try {
      seed(dir);
      const result = spawnSync('node', ['./e2e/scripts/verify-artifact-safety.mjs', dir], {
        cwd: webRoot,
        encoding: 'utf8',
      });
      return { status: result.status ?? -1, output: `${result.stdout}${result.stderr}` };
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  }

  it('fails on a planted bare token that carries no capability path prefix', () => {
    // A stand-in for a real secret: high-entropy, token-shaped, and never a live credential.
    const planted = 'PlantedFakeToken_0123456789abcdefgh-XYZ';
    const fingerprint = createHash('sha256').update(planted, 'utf8').digest('hex');

    const result = runSweep((dir) => {
      fs.writeFileSync(path.join(dir, '.capability-fingerprints'), `${fingerprint}\n`);
      // Exactly the shape observed in a real Playwright failure: a bare token in an error
      // message, with no `/c/` prefix for a pattern scan to find.
      fs.writeFileSync(
        path.join(dir, 'error-context.md'),
        `# Error details\n\nExpected substring: "${planted}"\n`,
      );
    });

    expect(result.status).toBe(1);
    expect(result.output).toMatch(/raw capability token in contents/);
    expect(result.output).toContain('error-context.md');
  });

  it('fails on a percent-encoded planted token and on an unverifiable archive', () => {
    const planted = 'PlantedFakeToken_abcdefgh0123456789-QRS';
    const fingerprint = createHash('sha256').update(planted, 'utf8').digest('hex');

    const encoded = runSweep((dir) => {
      fs.writeFileSync(path.join(dir, '.capability-fingerprints'), `${fingerprint}\n`);
      fs.writeFileSync(path.join(dir, 'report.json'), `{"url":"%2Fc%2F${planted}"}`);
    });
    expect(encoded.status).toBe(1);

    const archived = runSweep((dir) => {
      fs.writeFileSync(path.join(dir, 'trace.zip'), 'PK\u0003\u0004 not really a zip');
    });
    expect(archived.status).toBe(1);
    expect(archived.output).toMatch(/unverifiable archive/);
  });

  it('does not false-positive on opaque base64 that merely looks like a capability path', () => {
    // Standard base64 freely forms `/c/` plus 16 alphanumerics. That must not be treated as a
    // secret, and scrubbing it in place would corrupt an embedded Playwright report zip.
    const innocentBase64 = Buffer.from('padding-/c/ABCDEFGHIJKLMNOP-padding').toString('base64');
    const result = runSweep((dir) => {
      fs.writeFileSync(
        path.join(dir, 'index.html'),
        `<template id="playwrightReportBase64">data:application/zip;base64,${innocentBase64}</template>`,
      );
    });
    expect(result.status).toBe(0);
    expect(result.output).toMatch(/sweep passed/);
  });

  it('detects a fingerprinted token inside an opaque base64 payload', () => {
    const planted = 'PlantedFakeToken_opaqueBase64Hit01';
    const fingerprint = createHash('sha256').update(planted, 'utf8').digest('hex');
    const payload = Buffer.from(`leak:${planted}:end`).toString('base64');

    const result = runSweep((dir) => {
      fs.writeFileSync(path.join(dir, '.capability-fingerprints'), `${fingerprint}\n`);
      fs.writeFileSync(path.join(dir, 'index.html'), `data:application/zip;base64,${payload}`);
    });

    expect(result.status).toBe(1);
    expect(result.output).toMatch(/raw capability token inside opaque payload/);
  });

  it('passes on clean artifacts and does not mistake approved templates for secrets', () => {
    const planted = 'PlantedFakeToken_0123456789abcdefgh-TUV';
    const fingerprint = createHash('sha256').update(planted, 'utf8').digest('hex');

    const result = runSweep((dir) => {
      fs.writeFileSync(path.join(dir, '.capability-fingerprints'), `${fingerprint}\n`);
      fs.writeFileSync(
        path.join(dir, 'server.log'),
        '{"routeTemplate":"/c/[token]"}\nGET /c/[redacted] 200\n',
      );
    });

    expect(result.status).toBe(0);
    expect(result.output).toMatch(/sweep passed/);
  });

  it('the sweep detects a bare token by fingerprint, not only by path prefix', () => {
    const sweep = fs.readFileSync(path.join(e2eRoot, 'scripts/verify-artifact-safety.mjs'), 'utf8');

    expect(sweep).toContain('containsFingerprintedToken');
    expect(sweep).toContain('sha256');
    // Archives cannot be inspected without decompressing, so they must fail closed.
    expect(sweep).toContain('ARCHIVE_EXTENSIONS');
    // An unreadable file must be reported, never skipped.
    expect(sweep).toMatch(/unreadable/);
    // A missing artifact tree must not silently pass as "nothing to verify".
    expect(sweep).not.toContain('nothing to verify');
  });

  it('the log redactor strips capability tokens from page and API paths', () => {
    const redactor = fs.readFileSync(path.join(e2eRoot, 'scripts/redact-stream.mjs'), 'utf8');

    expect(redactor).toContain('/c/[redacted]');
    expect(redactor).toContain('/api/v1/capabilities/[redacted]');
  });
});

describe('P1.2 does not introduce production UI coupling', () => {
  it('adds no data-testid attributes to application components', () => {
    const appSources = [
      ...readAllFiles(path.join(webRoot, 'app'), ['.tsx']),
      ...readAllFiles(path.join(webRoot, 'lib'), ['.tsx']),
    ];

    const offenders = appSources.filter(({ contents }) => contents.includes('data-testid'));

    expect(offenders.map(({ file }) => file)).toEqual([]);
  });
});
