// @vitest-environment node
import { readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const here = path.dirname(fileURLToPath(import.meta.url));
const transportDir = path.resolve(here, '..', 'lib/gmail/transport');
const outboundDir = path.resolve(here, '..', 'lib/gmail/outbound');

function listTs(dir: string): string[] {
  return readdirSync(dir)
    .filter((f) => f.endsWith('.ts') && !f.endsWith('.d.ts'))
    .map((f) => path.join(dir, f));
}

describe('A7.4 transport packaging + boundary guard', () => {
  it('transport/outbound modules never import the DB runtime (no handoff/state mutation)', () => {
    const offenders: string[] = [];
    for (const file of [...listTs(transportDir), ...listTs(outboundDir)]) {
      const content = readFileSync(file, 'utf8');
      if (
        /from\s+['"]@aicaa\/db(\/[^'"]*)?['"]/.test(content) ||
        /from\s+['"]@\/lib\/db\//.test(content)
      ) {
        offenders.push(path.basename(file));
      }
    }
    expect(offenders, `Transport must not depend on the DB layer: ${offenders.join(', ')}`).toEqual(
      [],
    );
  });

  it('transport modules do not call handoff transaction primitives', () => {
    const forbidden = [
      'beginInitialHandoff',
      'markHandoffSendAccepted',
      'markHandoffDeliveryFailed',
      'markHandoffAttemptSent',
      'markHandoffAttemptFailed',
    ];
    for (const file of [...listTs(transportDir), ...listTs(outboundDir)]) {
      const content = readFileSync(file, 'utf8');
      for (const name of forbidden) {
        expect(content.includes(name), `${path.basename(file)} references ${name}`).toBe(false);
      }
    }
  });

  it('loads the transport barrel in a Node context with the expected exports', async () => {
    const mod = await import('@/lib/gmail/transport');
    expect(typeof mod.createGmailTransport).toBe('function');
    expect(typeof mod.buildMimeMessage).toBe('function');
    expect(typeof mod.buildAssignmentEmail).toBe('function');
    expect(typeof mod.buildGmailForward).toBe('function');
    expect(typeof mod.evaluateGmailSendCapability).toBe('function');
    expect(typeof mod.transportFailure).toBe('function');
    expect(mod.GMAIL_SEND_HARD_MAX_MESSAGE_BYTES).toBe(36_700_160);
  });
});
