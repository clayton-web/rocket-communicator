// @vitest-environment node
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import * as runtime from '../src/runtime.js';
import * as testing from '../src/testing.js';

const packageRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

const REQUIRED_RUNTIME_EXPORTS = [
  'createPrismaClient',
  'getTaskById',
  'listTasks',
  'createTask',
  'getRecipientById',
  'createAuditEvent',
  'persistOwnerTaskMutation',
  'persistReturnToOwner',
  'findCapabilityByTokenHash',
  'createCapability',
  'findActiveCapabilitiesForAssignment',
  'revokeCapabilityRecord',
  'updateActiveAssignmentCapabilityBinding',
  'updateTaskWithExpectedVersion',
  'getCapabilityById',
  'markCapabilityExpiredRecord',
  'persistCapabilityAction',
  'persistWorkRequest',
  'listTaskSuggestions',
  'getTaskSuggestionById',
  'persistApproveTaskSuggestion',
  'persistEditTaskSuggestion',
  'persistDismissTaskSuggestion',
  'persistMergeTaskSuggestion',
  'getCommunicationAccountByOrganization',
  'getCommunicationAccountById',
  'getGmailOAuthCredentialByAccountId',
  'listEligibleGmailAccountsForPoll',
  'createGmailOAuthState',
  'consumeGmailOAuthState',
  'inspectGmailOAuthState',
  'deleteFinishedGmailOAuthStates',
  'persistGmailConnectionTransaction',
  'persistGmailDisconnectTransaction',
  'acquireGmailSyncLock',
  'releaseGmailSyncLock',
  'markCommunicationAccountNeedsReauth',
  'markCommunicationAccountResyncRequired',
  'createGmailSyncRun',
  'finishGmailSyncRun',
  'listGmailSyncRuns',
  'persistGmailHistoryPageTransaction',
];

describe('@aicaa/db/runtime entry', () => {
  it('exposes all required production exports', () => {
    for (const exportName of REQUIRED_RUNTIME_EXPORTS) {
      expect(typeof runtime[exportName as keyof typeof runtime]).not.toBe('undefined');
    }
  });

  it('does not export createTestDatabase', () => {
    expect('createTestDatabase' in runtime).toBe(false);
  });
});

describe('@aicaa/db/testing entry', () => {
  it('exports createTestDatabase', () => {
    expect(typeof testing.createTestDatabase).toBe('function');
  });
});

describe('built runtime entry', () => {
  it('does not include PGlite modules in the runtime import graph', () => {
    const runtimeJs = path.join(packageRoot, 'dist/runtime.js');
    expect(fs.existsSync(runtimeJs)).toBe(true);

    const content = fs.readFileSync(runtimeJs, 'utf8');
    expect(content).not.toContain('@electric-sql/pglite');
    expect(content).not.toContain('pglite-prisma-adapter');
    expect(content).not.toContain('create-test-database');
  });

  it('has no top-level await in dist/runtime.js', () => {
    const runtimeJs = path.join(packageRoot, 'dist/runtime.js');
    const content = fs.readFileSync(runtimeJs, 'utf8');
    expect(/^\s*await\s+/m.test(content)).toBe(false);
  });

  it('supports require(esm) for @aicaa/db/runtime when dist is built', () => {
    const runtimeJs = path.join(packageRoot, 'dist/runtime.js');
    if (!fs.existsSync(runtimeJs)) {
      return;
    }

    const req = createRequire(import.meta.url);
    const resolved = req.resolve('@aicaa/db/runtime');
    expect(resolved).toContain('dist/runtime.js');

    const loaded = req('@aicaa/db/runtime') as Record<string, unknown>;
    expect(typeof loaded.createPrismaClient).toBe('function');
    expect(loaded.createTestDatabase).toBeUndefined();
  });

  it('loads domain runtime transitively through a relative import when requiring @aicaa/db/runtime', () => {
    const runtimeJs = path.join(packageRoot, 'dist/runtime.js');
    if (!fs.existsSync(runtimeJs)) {
      return;
    }

    const mapperJs = path.join(packageRoot, 'dist/mappers/domain-mappers.js');
    expect(fs.existsSync(mapperJs)).toBe(true);
    const mapperContent = fs.readFileSync(mapperJs, 'utf8');
    expect(mapperContent).not.toContain('@aicaa/domain');
    expect(mapperContent).toContain('../../../domain/dist/index.js');
    expect(
      fs.existsSync(path.resolve(path.dirname(mapperJs), '../../../domain/dist/index.js')),
    ).toBe(true);

    const req = createRequire(runtimeJs);
    const loaded = req('@aicaa/db/runtime') as Record<string, unknown>;
    expect(typeof loaded.createPrismaClient).toBe('function');
    expect(typeof loaded.mapTask).toBe('function');
  });
});
