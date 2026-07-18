import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { cleanupKotlinOrphans } from './cleanup-kotlin-orphans.mjs';
import { KOTLIN_GENERATE_ARGS } from './kotlin-generator-args.mjs';

const root = path.dirname(fileURLToPath(import.meta.url));
const contractsRoot = path.resolve(root, '..');
const generatorCli = path.join(contractsRoot, 'node_modules', '.bin', 'openapi-generator-cli');

execFileSync(generatorCli, KOTLIN_GENERATE_ARGS, { cwd: contractsRoot, stdio: 'inherit' });

const removed = cleanupKotlinOrphans();
if (removed.length > 0) {
  console.log(`Removed ${removed.length} stale Kotlin generated file(s).`);
}
