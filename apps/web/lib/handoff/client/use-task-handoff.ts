'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { components } from '@aicaa/contracts/schema';
import {
  fetchActiveRecipients,
  fetchGmailConnection,
  fetchOwnerTask,
  postTaskHandoff,
  startGmailOAuthNavigation,
} from '@/lib/owner/api-client';
import {
  clearPendingHandoffOperation,
  createPendingHandoffOperation,
  isPendingHandoffExpired,
  readPendingHandoffOperation,
  updatePendingHandoffOperation,
  writePendingHandoffOperation,
  type PendingHandoffOperation,
  type PendingHandoffOutcomeCategory,
} from './pending-operation';
import type { ParsedPublicError } from './public-errors';
import {
  deliveryExplanationCopy,
  deliveryPathLabel,
  predictDeliveryPathFromSourceType,
} from './delivery-copy';

type TaskDto = components['schemas']['Task'];
type RecipientDto = components['schemas']['Recipient'];
type GmailConnectionDto = components['schemas']['GmailConnection'];
type HandoffTaskResponse = components['schemas']['HandoffTaskResponse'];

export type HandoffBannerTone = 'info' | 'success' | 'error' | 'warning';

export interface HandoffBanner {
  tone: HandoffBannerTone;
  text: string;
}

export interface UseTaskHandoffResult {
  task: TaskDto;
  recipients: RecipientDto[];
  recipientsLoading: boolean;
  recipientsError: string | null;
  recipientsNextCursor: string | null;
  loadMoreRecipients: () => Promise<void>;
  selectedRecipientId: string;
  setSelectedRecipientId: (id: string) => void;
  selectedRecipient: RecipientDto | undefined;
  connection: GmailConnectionDto | null;
  connectionLoading: boolean;
  predictedPathLabel: string;
  predictedExplanation: string;
  canShowHandoffAction: boolean;
  handoffDisabledReason: string | null;
  dialogOpen: boolean;
  openDialog: () => void;
  closeDialog: () => void;
  submitting: boolean;
  banner: HandoffBanner | null;
  clearBanner: () => void;
  pending: PendingHandoffOperation | null;
  lastSuccess: HandoffTaskResponse | null;
  confirmHandoff: () => Promise<void>;
  retryOrCheckHandoff: () => Promise<void>;
  startReconsent: () => void;
  showRetryAfterReconsent: boolean;
  showCheckStatus: boolean;
  showRetryHandoff: boolean;
}

function isTerminalStatus(status: TaskDto['status']): boolean {
  return status === 'completed' || status === 'dismissed';
}

function successBanner(response: HandoffTaskResponse): HandoffBanner {
  const name = response.recipient.displayName;
  if (response.idempotentReplay) {
    return {
      tone: 'success',
      text: 'This assignment was already sent. Showing the current status.',
    };
  }
  return {
    tone: 'success',
    text: `Assignment sent to ${name}.`,
  };
}

function bannerForError(error: ParsedPublicError): HandoffBanner {
  const tone: HandoffBannerTone =
    error.outcomeCategory === 'ambiguous' || error.outcomeCategory === 'in_progress'
      ? 'warning'
      : 'error';
  return { tone, text: error.message };
}

export interface UseTaskHandoffInput {
  initialTask: TaskDto;
  initialRecipients: RecipientDto[];
  recipientsNextCursor: string | null;
  initialConnection: GmailConnectionDto;
}

function readInitialPending(task: TaskDto): {
  pending: PendingHandoffOperation | null;
  selectedRecipientId: string;
  showRetryAfterReconsent: boolean;
} {
  if (typeof window === 'undefined') {
    return { pending: null, selectedRecipientId: '', showRetryAfterReconsent: false };
  }
  const stored = readPendingHandoffOperation(task.id);
  if (!stored) {
    return { pending: null, selectedRecipientId: '', showRetryAfterReconsent: false };
  }
  if (isPendingHandoffExpired(stored) && task.assignment) {
    clearPendingHandoffOperation(task.id);
    return { pending: null, selectedRecipientId: '', showRetryAfterReconsent: false };
  }
  return {
    pending: stored,
    selectedRecipientId: stored.recipientId,
    showRetryAfterReconsent: stored.reconsentPending === true,
  };
}

export function useTaskHandoff(input: UseTaskHandoffInput): UseTaskHandoffResult {
  const { initialTask, initialRecipients, initialConnection } = input;
  const [boot] = useState(() => readInitialPending(initialTask));
  const [task, setTask] = useState(initialTask);
  const [recipients, setRecipients] = useState<RecipientDto[]>(initialRecipients);
  const [recipientsNextCursor, setRecipientsNextCursor] = useState<string | null>(
    input.recipientsNextCursor,
  );
  const [recipientsLoading, setRecipientsLoading] = useState(false);
  const [recipientsError, setRecipientsError] = useState<string | null>(null);
  const [selectedRecipientId, setSelectedRecipientIdState] = useState(boot.selectedRecipientId);
  const [connection, setConnection] = useState<GmailConnectionDto | null>(initialConnection);
  const [connectionLoading] = useState(false);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [banner, setBanner] = useState<HandoffBanner | null>(null);
  const [pending, setPending] = useState<PendingHandoffOperation | null>(boot.pending);
  const [lastSuccess, setLastSuccess] = useState<HandoffTaskResponse | null>(null);
  const [showRetryAfterReconsent, setShowRetryAfterReconsent] = useState(
    boot.showRetryAfterReconsent,
  );
  const submitGuard = useRef(false);

  const selectedRecipient = useMemo(
    () => recipients.find((r) => r.id === selectedRecipientId),
    [recipients, selectedRecipientId],
  );

  const predictedPath = predictDeliveryPathFromSourceType(task.sourceReference?.sourceType);
  const predictedPathLabel = deliveryPathLabel(predictedPath);
  const predictedExplanation = deliveryExplanationCopy(predictedPath);

  const assigned = Boolean(task.assignment);
  const canShowHandoffAction =
    !assigned &&
    !isTerminalStatus(task.status) &&
    Boolean(task.etag) &&
    recipients.length > 0 &&
    !lastSuccess;

  let handoffDisabledReason: string | null = null;
  if (!assigned && !isTerminalStatus(task.status)) {
    if (!task.etag) {
      handoffDisabledReason = 'Task version is unavailable. Refresh the page.';
    } else if (recipientsLoading) {
      handoffDisabledReason = 'Loading Recipients…';
    } else if (recipientsError) {
      handoffDisabledReason = 'Recipients could not be loaded. Refresh and try again.';
    } else if (recipients.length === 0) {
      handoffDisabledReason = 'No active Recipients are available.';
    }
  }

  const showCheckStatus =
    pending != null &&
    (pending.lastOutcomeCategory === 'in_progress' || pending.lastOutcomeCategory === 'ambiguous');
  const showRetryHandoff =
    pending != null &&
    (pending.lastOutcomeCategory === 'retryable_failure' ||
      pending.lastOutcomeCategory === 'preparation_failure' ||
      showRetryAfterReconsent ||
      pending.lastOutcomeCategory === 'reconsent_required' ||
      pending.lastOutcomeCategory === 'not_connected');

  const refreshTask = useCallback(async () => {
    const result = await fetchOwnerTask(task.id);
    if (result.ok) {
      setTask(result.data);
      return result.data;
    }
    return null;
  }, [task.id]);

  const loadRecipients = useCallback(async (cursor?: string | null, append = false) => {
    setRecipientsLoading(true);
    setRecipientsError(null);
    const result = await fetchActiveRecipients({ cursor, limit: 25 });
    setRecipientsLoading(false);
    if (!result.ok) {
      setRecipientsError(result.error.message);
      return;
    }
    setRecipients((prev) => (append ? [...prev, ...result.data.items] : result.data.items));
    setRecipientsNextCursor(result.data.nextCursor);
  }, []);

  const loadMoreRecipients = useCallback(async () => {
    if (!recipientsNextCursor || recipientsLoading) {
      return;
    }
    await loadRecipients(recipientsNextCursor, true);
  }, [loadRecipients, recipientsNextCursor, recipientsLoading]);

  const setSelectedRecipientId = useCallback(
    (id: string) => {
      // Changing Recipient before a durable op begins starts a new logical request later.
      if (pending && pending.lastOutcomeCategory) {
        const durable = ![
          'validation',
          'stale',
          'inactive_recipient',
          'unauthorized',
          'not_found',
          'reconsent_required',
          'not_connected',
        ].includes(pending.lastOutcomeCategory);
        // If a durable attempt may exist, do not swap Recipient / key.
        if (
          durable ||
          pending.lastOutcomeCategory === 'in_progress' ||
          pending.lastOutcomeCategory === 'ambiguous' ||
          pending.lastOutcomeCategory === 'retryable_failure' ||
          pending.lastOutcomeCategory === 'permanent_failure' ||
          pending.lastOutcomeCategory === 'preparation_failure' ||
          pending.lastOutcomeCategory === 'success' ||
          pending.lastOutcomeCategory === 'replay_success'
        ) {
          return;
        }
      }
      setSelectedRecipientIdState(id);
    },
    [pending],
  );

  useEffect(() => {
    if (typeof window === 'undefined') {
      return;
    }
    const url = new URL(window.location.href);
    const gmail = url.searchParams.get('gmail');
    const gmailError = url.searchParams.get('gmail_error');
    if (!gmail && !gmailError) {
      return;
    }

    url.searchParams.delete('gmail');
    url.searchParams.delete('gmail_error');
    window.history.replaceState({}, '', url.pathname + url.search + url.hash);

    void (async () => {
      const conn = await fetchGmailConnection();
      if (conn.ok) {
        setConnection(conn.data);
      }
      const stored = readPendingHandoffOperation(task.id);
      if (stored) {
        setPending(stored);
        setSelectedRecipientIdState(stored.recipientId);
      }
      if (gmail === 'connected') {
        setBanner({
          tone: 'success',
          text: 'Gmail permissions updated. Review the Recipient, then retry this handoff.',
        });
        setShowRetryAfterReconsent(true);
        updatePendingHandoffOperation(task.id, {
          reconsentPending: false,
          lastOutcomeCategory: 'reconsent_required',
        });
      } else if (gmailError) {
        setBanner({
          tone: 'error',
          text: 'Gmail permission update did not complete. You can try again when ready.',
        });
      }
    })();
  }, [task.id]);

  const runOperation = useCallback(
    async (operation: PendingHandoffOperation) => {
      if (submitGuard.current) {
        return;
      }
      submitGuard.current = true;
      setSubmitting(true);
      setBanner(null);
      try {
        const result = await postTaskHandoff({
          taskId: operation.taskId,
          recipientId: operation.recipientId,
          ifMatch: operation.originalIfMatch,
          idempotencyKey: operation.idempotencyKey,
        });

        if (!result.ok) {
          const error = result.error;
          const next: PendingHandoffOperation = {
            ...operation,
            lastOutcomeCategory: error.outcomeCategory,
            reconsentPending: error.outcomeCategory === 'reconsent_required',
          };
          writePendingHandoffOperation(next);
          setPending(next);
          setBanner(bannerForError(error));
          setShowRetryAfterReconsent(error.outcomeCategory === 'reconsent_required');

          if (error.refetchTask || error.outcomeCategory === 'conflict') {
            const refreshed = await refreshTask();
            if (refreshed?.assignment) {
              // Assigned after durable begin — never return to a fresh unassigned form.
              setDialogOpen(false);
            }
          }
          if (error.refetchRecipients && error.allowNewOperation) {
            clearPendingHandoffOperation(operation.taskId);
            setPending(null);
            setSelectedRecipientIdState('');
            await loadRecipients(null, false);
          }
          if (error.outcomeCategory === 'conflict' && error.code === 'IDEMPOTENCY_KEY_CONFLICT') {
            clearPendingHandoffOperation(operation.taskId);
            setPending(null);
          }
          return;
        }

        const response = result.data;
        setLastSuccess(response);
        setBanner(successBanner(response));
        setDialogOpen(false);
        setShowRetryAfterReconsent(false);
        const refreshed = await refreshTask();
        if (refreshed) {
          clearPendingHandoffOperation(operation.taskId);
          setPending(null);
        } else {
          // Keep enough state to render if refresh failed; still clear key after success body.
          writePendingHandoffOperation({
            ...operation,
            lastOutcomeCategory: response.idempotentReplay ? 'replay_success' : 'success',
          });
          clearPendingHandoffOperation(operation.taskId);
          setPending(null);
        }
      } finally {
        setSubmitting(false);
        submitGuard.current = false;
      }
    },
    [loadRecipients, refreshTask],
  );

  const confirmHandoff = useCallback(async () => {
    if (!selectedRecipientId || !task.etag) {
      return;
    }
    const operation = createPendingHandoffOperation({
      taskId: task.id,
      recipientId: selectedRecipientId,
      originalIfMatch: task.etag,
    });
    writePendingHandoffOperation(operation);
    setPending(operation);
    await runOperation(operation);
  }, [runOperation, selectedRecipientId, task.etag, task.id]);

  const retryOrCheckHandoff = useCallback(async () => {
    const operation = pending ?? readPendingHandoffOperation(task.id);
    if (!operation) {
      return;
    }
    setShowRetryAfterReconsent(false);
    await runOperation(operation);
  }, [pending, runOperation, task.id]);

  const startReconsent = useCallback(() => {
    const operation = pending ?? readPendingHandoffOperation(task.id);
    if (operation) {
      const next = {
        ...operation,
        reconsentPending: true,
        lastOutcomeCategory: 'reconsent_required' as PendingHandoffOutcomeCategory,
      };
      writePendingHandoffOperation(next);
      setPending(next);
    }
    startGmailOAuthNavigation(`/tasks/${task.id}`);
  }, [pending, task.id]);

  return {
    task,
    recipients,
    recipientsLoading,
    recipientsError,
    recipientsNextCursor,
    loadMoreRecipients,
    selectedRecipientId,
    setSelectedRecipientId,
    selectedRecipient,
    connection,
    connectionLoading,
    predictedPathLabel,
    predictedExplanation,
    canShowHandoffAction,
    handoffDisabledReason,
    dialogOpen,
    openDialog: () => setDialogOpen(true),
    closeDialog: () => setDialogOpen(false),
    submitting,
    banner,
    clearBanner: () => setBanner(null),
    pending,
    lastSuccess,
    confirmHandoff,
    retryOrCheckHandoff,
    startReconsent,
    showRetryAfterReconsent,
    showCheckStatus,
    showRetryHandoff,
  };
}
