#!/usr/bin/env node
/**
 * Documentation-governance verification for docs/DECISIONS.md.
 *
 *   pnpm docs:decisions:verify
 *   pnpm docs:decisions:verify --verbose
 *
 * Authorized by D165 as a verification precondition for the later representation change.
 * D165 does not authorize wiring this into `pnpm verify`, CI, pre-commit hooks or deployment
 * gates; those integrations need separate review. It runs through its own command only.
 *
 * Exit code 1 means a hard governance invariant broke. Human-review items never change the
 * exit code — they are work for the reviewer of the batch in progress.
 */

import { formatReport } from './lib/report.mjs';
import { runVerification } from './lib/verify.mjs';
import { BASELINE_PATH, CITATION_EXCLUSIONS, REGISTER_PATH, REPO_ROOT } from './paths.mjs';

function parseArguments(argv) {
  const options = {
    verbose: false,
    scanCitations: true,
    registerPath: REGISTER_PATH,
    baselinePath: BASELINE_PATH,
  };

  for (const argument of argv) {
    if (argument === '--verbose') options.verbose = true;
    else if (argument === '--no-citations') options.scanCitations = false;
    else if (argument.startsWith('--register=')) options.registerPath = argument.slice(11);
    else if (argument.startsWith('--baseline=')) options.baselinePath = argument.slice(11);
    else {
      process.stderr.write(`unknown option: ${argument}\n`);
      process.exit(2);
    }
  }

  return options;
}

const options = parseArguments(process.argv.slice(2));

const result = runVerification({
  registerPath: options.registerPath,
  baselinePath: options.baselinePath,
  repoRoot: REPO_ROOT,
  scanCitations: options.scanCitations,
  citationExclusions: CITATION_EXCLUSIONS,
});

process.stdout.write(
  `${formatReport(result.findings, {
    title: `Decision register verification — ${options.registerPath}`,
    checks: result.checks,
    verbose: options.verbose,
  })}\n`,
);

process.exit(result.findings.failures.length === 0 ? 0 : 1);
