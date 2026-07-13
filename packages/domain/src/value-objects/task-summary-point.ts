export type SummaryPointKind =
  | 'confirmed_fact'
  | 'request'
  | 'commitment'
  | 'amount'
  | 'deadline'
  | 'risk'
  | 'inference'
  | 'missing_information'
  | 'next_action';

export type Sensitivity = 'normal' | 'financial' | 'legal' | 'personal';

export interface SourceSpanRef {
  excerptId: string;
  startOffset?: number;
  endOffset?: number;
}

interface SummaryPointBase {
  id: string;
  kind: SummaryPointKind;
  label: string;
  order: number;
  sensitivity?: Sensitivity;
  sourceSpanRef?: SourceSpanRef;
}

export interface TextSummaryPoint extends SummaryPointBase {
  kind: 'confirmed_fact' | 'request' | 'commitment' | 'risk' | 'next_action';
  value: string;
}

export interface InferenceSummaryPoint extends SummaryPointBase {
  kind: 'inference';
  value: string;
  confidence: number;
}

export interface MissingInformationSummaryPoint extends SummaryPointBase {
  kind: 'missing_information';
  missingItem: string;
}

export interface AmountSummaryPoint extends SummaryPointBase {
  kind: 'amount';
  amount: number;
  currency: string;
}

export interface DeadlineSummaryPoint extends SummaryPointBase {
  kind: 'deadline';
  dueAt?: string;
  localDate?: string;
  timezone?: string;
}

export type TaskSummaryPoint =
  | TextSummaryPoint
  | InferenceSummaryPoint
  | MissingInformationSummaryPoint
  | AmountSummaryPoint
  | DeadlineSummaryPoint;

export const MAX_SUMMARY_POINTS = 20;
export const MAX_LABEL_LENGTH = 120;
export const MAX_TEXT_VALUE_LENGTH = 500;
