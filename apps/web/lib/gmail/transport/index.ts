import 'server-only';

/**
 * A7.4 Gmail transport barrel. Single import surface for later application orchestration.
 * Transport is pure send/compose infrastructure — it never touches DB state or handoff lifecycle.
 */
export * from './limits';
export * from './scopes';
export * from './send-capability';
export * from './outbound-types';
export * from './mime';
export * from './errors';
export * from './gmail-transport';
export { buildAssignmentEmail, type AssignmentEmailInput } from '../outbound/assignment-email';
export {
  buildGmailForward,
  type GmailForwardInput,
  type GmailForwardDeps,
  type GmailForwardSource,
  type GmailForwardBuildResult,
} from '../outbound/gmail-forward';
export {
  escapeHtml,
  escapeHtmlAttribute,
  normalizeForwardSubject,
  plainTextToHtml,
} from '../outbound/text-utils';
