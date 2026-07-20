/**
 * Explanatory delivery-mode copy for Owner UI.
 * Prediction only — never submitted; server deliveryPath is authoritative after success.
 */

export type PredictedDeliveryPath = 'gmail_forward' | 'assignment_email';

export function predictDeliveryPathFromSourceType(
  sourceType: string | null | undefined,
): PredictedDeliveryPath {
  return sourceType === 'gmail' ? 'gmail_forward' : 'assignment_email';
}

export function deliveryExplanationCopy(path: PredictedDeliveryPath): string {
  if (path === 'gmail_forward') {
    return 'The original Gmail message and its available attachments will be forwarded with the Task summary and a secure action link.';
  }
  return 'A new assignment email will be sent with the Task summary and a secure action link.';
}

export function deliveryPathLabel(path: 'gmail_forward' | 'assignment_email'): string {
  return path === 'gmail_forward' ? 'Gmail forward' : 'Assignment email';
}
