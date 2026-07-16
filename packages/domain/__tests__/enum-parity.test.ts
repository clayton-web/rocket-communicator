import { describe, expect, it } from 'vitest';
import type { components } from '@aicaa/contracts/schema';
import { API_DOMAIN_STATUS_MAP } from '../src/mapping/enum-parity.js';

type ApiTaskStatus = components['schemas']['TaskStatus'];
type DomainTaskStatus =
  (typeof API_DOMAIN_STATUS_MAP.task)[keyof typeof API_DOMAIN_STATUS_MAP.task];

describe('api/domain mapper compatibility', () => {
  it('keeps task status enums aligned', () => {
    const apiStatuses: ApiTaskStatus[] = [
      'open',
      'in_progress',
      'waiting',
      'completed',
      'dismissed',
    ];
    const mapped = apiStatuses.map(
      (status) => API_DOMAIN_STATUS_MAP.task[status] as DomainTaskStatus,
    );
    expect(mapped).toEqual(apiStatuses);
  });

  it('keeps suggestion status enums aligned', () => {
    const apiStatuses = ['pending', 'approved', 'dismissed', 'merged'] as const;
    const mapped = apiStatuses.map((status) => API_DOMAIN_STATUS_MAP.taskSuggestion[status]);
    expect(mapped).toEqual([...apiStatuses]);
  });

  it('keeps Gmail connection status enums aligned', () => {
    const apiStatuses: components['schemas']['GmailConnectionStatus'][] = [
      'not_connected',
      'pending',
      'connected',
      'needs_reauth',
      'resync_required',
      'disconnected',
      'error',
    ];
    const mapped = apiStatuses.map((status) => API_DOMAIN_STATUS_MAP.gmailConnectionStatus[status]);
    expect(mapped).toEqual(apiStatuses);
  });

  it('keeps Gmail sync outcome enums aligned', () => {
    const apiStatuses: components['schemas']['GmailSyncOutcome'][] = [
      'running',
      'succeeded',
      'partial',
      'retryable_failure',
      'permanent_failure',
      'skipped_locked',
      'needs_reauth',
      'resync_required',
    ];
    const mapped = apiStatuses.map((status) => API_DOMAIN_STATUS_MAP.gmailSyncOutcome[status]);
    expect(mapped).toEqual(apiStatuses);
  });
});
