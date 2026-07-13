export type TaskServiceErrorCode =
  | 'NOT_FOUND'
  | 'VALIDATION_ERROR'
  | 'INVALID_STATE_TRANSITION'
  | 'PRECONDITION_REQUIRED'
  | 'PRECONDITION_FAILED'
  | 'DOMAIN_CONFLICT'
  | 'FORBIDDEN'
  | 'ASSIGNMENT_PRECONDITION'
  | 'PERSISTENCE_CONFLICT';

export class TaskServiceError extends Error {
  readonly code: TaskServiceErrorCode;
  readonly details?: ReadonlyArray<{ field: string; message: string }>;

  constructor(
    code: TaskServiceErrorCode,
    message: string,
    details?: ReadonlyArray<{ field: string; message: string }>,
  ) {
    super(message);
    this.name = 'TaskServiceError';
    this.code = code;
    this.details = details ? Object.freeze([...details]) : undefined;
  }
}

export function taskServiceError(
  code: TaskServiceErrorCode,
  message: string,
  details?: ReadonlyArray<{ field: string; message: string }>,
): TaskServiceError {
  return new TaskServiceError(code, message, details);
}
