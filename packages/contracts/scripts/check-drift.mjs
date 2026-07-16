import { execSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const root = path.dirname(fileURLToPath(import.meta.url));
const contractsRoot = path.resolve(root, '..');
const repoRoot = path.resolve(contractsRoot, '../..');

execSync('pnpm generate', { cwd: contractsRoot, stdio: 'inherit' });
execSync('node scripts/cleanup-kotlin-orphans.mjs --check', {
  cwd: contractsRoot,
  stdio: 'inherit',
});
execSync('git diff --exit-code -- packages/contracts/dist packages/contracts/generated', {
  cwd: repoRoot,
  stdio: 'inherit',
});
