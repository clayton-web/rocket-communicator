/** Maps API enum strings to domain literals for compatibility testing. */
export const API_DOMAIN_STATUS_MAP = {
  taskSuggestion: {
    pending: 'pending',
    approved: 'approved',
    dismissed: 'dismissed',
    merged: 'merged',
  },
  task: {
    open: 'open',
    in_progress: 'in_progress',
    waiting: 'waiting',
    completed: 'completed',
    dismissed: 'dismissed',
  },
  role: {
    owner: 'owner',
  },
  gmailConnectionStatus: {
    not_connected: 'not_connected',
    pending: 'pending',
    connected: 'connected',
    needs_reauth: 'needs_reauth',
    resync_required: 'resync_required',
    disconnected: 'disconnected',
    error: 'error',
  },
  gmailSyncOutcome: {
    running: 'running',
    succeeded: 'succeeded',
    partial: 'partial',
    retryable_failure: 'retryable_failure',
    permanent_failure: 'permanent_failure',
    skipped_locked: 'skipped_locked',
    needs_reauth: 'needs_reauth',
    resync_required: 'resync_required',
  },
} as const;
