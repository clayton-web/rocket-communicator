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
    primary: 'primary',
    administrator: 'administrator',
  },
} as const;
