import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const HARNESS_ROOT = path.dirname(fileURLToPath(import.meta.url));
export const REPO_ROOT = path.resolve(HARNESS_ROOT, '../..');

export const REGISTER_PATH = path.join(REPO_ROOT, 'docs/DECISIONS.md');
export const BASELINE_PATH = path.join(HARNESS_ROOT, 'baseline/decisions-baseline.json');

/**
 * Repository-relative paths whose Dxxx tokens are not external citations.
 *
 * The baseline quotes the register verbatim, so its identifiers *are* the register. The
 * harness's tests and fixtures are synthetic register data and deliberately include
 * identifiers that do not resolve, which is how the unresolved-citation path is proved.
 */
export const CITATION_EXCLUSIONS = [
  'scripts/docs-governance/baseline/decisions-baseline.json',
  'scripts/docs-governance/__tests__',
];
