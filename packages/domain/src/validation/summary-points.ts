import {
  MAX_LABEL_LENGTH,
  MAX_SUMMARY_POINTS,
  MAX_TEXT_VALUE_LENGTH,
  type TaskSummaryPoint,
} from '../value-objects/task-summary-point.js';
import { validationError } from '../errors/domain-errors.js';

const CURRENCY_PATTERN = /^[A-Z]{3}$/;

export function validateSummaryPoints(points: TaskSummaryPoint[]): void {
  if (points.length < 1) {
    throw validationError('At least one summary point is required.');
  }
  if (points.length > MAX_SUMMARY_POINTS) {
    throw validationError(`Summary points cannot exceed ${MAX_SUMMARY_POINTS}.`);
  }

  const orders = new Set<number>();
  for (const point of points) {
    if (point.label.length > MAX_LABEL_LENGTH) {
      throw validationError(`Summary point label exceeds ${MAX_LABEL_LENGTH} characters.`, [
        { field: 'label', message: 'Label too long.' },
      ]);
    }
    if (orders.has(point.order)) {
      throw validationError('Summary point order values must be unique.');
    }
    orders.add(point.order);

    switch (point.kind) {
      case 'inference':
        if (point.confidence < 0 || point.confidence > 1) {
          throw validationError('Inference summary points require confidence between 0 and 1.');
        }
        if (point.value.length > MAX_TEXT_VALUE_LENGTH) {
          throw validationError('Inference value exceeds maximum length.');
        }
        break;
      case 'missing_information':
        if (point.missingItem.length > MAX_TEXT_VALUE_LENGTH) {
          throw validationError('Missing information item exceeds maximum length.');
        }
        break;
      case 'amount':
        if (!CURRENCY_PATTERN.test(point.currency)) {
          throw validationError('Amount summary points require an ISO 4217 currency code.');
        }
        break;
      case 'deadline':
        if (!point.dueAt && !(point.localDate && point.timezone)) {
          throw validationError(
            'Deadline summary points require dueAt or localDate with timezone.',
          );
        }
        break;
      default:
        if ('value' in point && point.value.length > MAX_TEXT_VALUE_LENGTH) {
          throw validationError('Summary point value exceeds maximum length.');
        }
    }
  }
}
