import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

const repoRoot = path.resolve(__dirname, '../../..');

describe('Vercel / Production web build pipeline', () => {
  it('keeps root build order domain → ai → db → web', () => {
    const pkg = JSON.parse(readFileSync(path.join(repoRoot, 'package.json'), 'utf8')) as {
      scripts: Record<string, string>;
    };
    expect(pkg.scripts['build:ai']).toBe('pnpm --filter @aicaa/ai build');
    expect(pkg.scripts.build).toBe(
      'pnpm build:domain && pnpm build:ai && pnpm build:db && pnpm build:web',
    );
    expect(pkg.scripts['build:vercel']).toBe(
      'pnpm build:domain && pnpm build:ai && pnpm build:db && pnpm --filter @aicaa/web build',
    );
  });

  it('builds @aicaa/ai before next build so outdated Vercel prefixes still succeed', () => {
    const webPkg = JSON.parse(
      readFileSync(path.join(repoRoot, 'apps/web/package.json'), 'utf8'),
    ) as { scripts: Record<string, string>; dependencies: Record<string, string> };
    expect(webPkg.dependencies['@aicaa/ai']).toBe('workspace:*');
    expect(webPkg.scripts.build).toBe('pnpm --filter @aicaa/ai build && next build');
  });

  it('exports @aicaa/ai from compiled dist, not source', () => {
    const aiPkg = JSON.parse(
      readFileSync(path.join(repoRoot, 'packages/ai/package.json'), 'utf8'),
    ) as {
      exports: { '.': { import: string; types: string } };
      dependencies: Record<string, string>;
    };
    expect(aiPkg.exports['.'].import).toBe('./dist/index.js');
    expect(aiPkg.exports['.'].types).toBe('./dist/index.d.ts');
    expect(aiPkg.dependencies['@aicaa/domain']).toBe('workspace:*');
  });

  it('does not make @aicaa/db depend on @aicaa/ai', () => {
    const dbPkg = JSON.parse(
      readFileSync(path.join(repoRoot, 'packages/db/package.json'), 'utf8'),
    ) as { dependencies: Record<string, string> };
    expect(dbPkg.dependencies['@aicaa/ai']).toBeUndefined();
  });
});
