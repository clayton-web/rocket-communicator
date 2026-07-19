import { jsonErrorResponse } from '@/lib/auth/http';
import { jsonErrorResponseWithDetails } from '@/lib/http/errors';
import type { NextResponse } from 'next/server';
import type { components } from '@aicaa/contracts/schema';

type ErrorResponse = components['schemas']['ErrorResponse'];

const MAX_DISPLAY_NAME = 200;
const MAX_EMAIL = 254;
const MAX_RELATIONSHIP_LABEL = 120;

// Conservative single-address email shape. Disallows whitespace (including CR/LF header
// injection) and requires a dotted domain.
const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export interface ParsedCreateRecipient {
  displayName: string;
  email: string;
  relationshipLabel?: string;
}

export interface ParsedUpdateRecipient {
  displayName?: string;
  email?: string;
  relationshipLabel?: string | null;
  /** Field names actually supplied by the Owner (drives changed-field audit; never values). */
  providedFields: string[];
}

function fail(
  message: string,
  details?: ReadonlyArray<{ field: string; message: string }>,
): { ok: false; response: NextResponse<ErrorResponse> } {
  return {
    ok: false,
    response: jsonErrorResponseWithDetails('VALIDATION_ERROR', message, 400, details),
  };
}

function has(body: Record<string, unknown>, key: string): boolean {
  return Object.prototype.hasOwnProperty.call(body, key);
}

function validateDisplayName(value: unknown): { ok: true; value: string } | { ok: false } {
  if (typeof value !== 'string') {
    return { ok: false };
  }
  const trimmed = value.trim();
  if (trimmed.length < 1 || trimmed.length > MAX_DISPLAY_NAME) {
    return { ok: false };
  }
  return { ok: true, value: trimmed };
}

function validateEmail(value: unknown): { ok: true; value: string } | { ok: false } {
  if (typeof value !== 'string') {
    return { ok: false };
  }
  const trimmed = value.trim();
  if (trimmed.length < 3 || trimmed.length > MAX_EMAIL || !EMAIL_PATTERN.test(trimmed)) {
    return { ok: false };
  }
  return { ok: true, value: trimmed };
}

function validateRelationshipLabel(value: unknown): { ok: true; value: string } | { ok: false } {
  if (typeof value !== 'string') {
    return { ok: false };
  }
  const trimmed = value.trim();
  if (trimmed.length < 1 || trimmed.length > MAX_RELATIONSHIP_LABEL) {
    return { ok: false };
  }
  return { ok: true, value: trimmed };
}

export function parseCreateRecipientBody(
  body: Record<string, unknown>,
):
  | { ok: true; value: ParsedCreateRecipient }
  | { ok: false; response: NextResponse<ErrorResponse> } {
  const displayName = validateDisplayName(body.displayName);
  if (!displayName.ok) {
    return fail('displayName is required and must be 1–200 characters.', [
      { field: 'displayName', message: 'Invalid display name.' },
    ]);
  }
  const email = validateEmail(body.email);
  if (!email.ok) {
    return fail('email is required and must be a valid email address.', [
      { field: 'email', message: 'Invalid email address.' },
    ]);
  }

  const value: ParsedCreateRecipient = {
    displayName: displayName.value,
    email: email.value,
  };

  if (has(body, 'relationshipLabel') && body.relationshipLabel !== undefined) {
    const label = validateRelationshipLabel(body.relationshipLabel);
    if (!label.ok) {
      return fail('relationshipLabel must be 1–120 characters.', [
        { field: 'relationshipLabel', message: 'Invalid relationship label.' },
      ]);
    }
    value.relationshipLabel = label.value;
  }

  return { ok: true, value };
}

export function parseUpdateRecipientBody(
  body: Record<string, unknown>,
):
  | { ok: true; value: ParsedUpdateRecipient }
  | { ok: false; response: NextResponse<ErrorResponse> } {
  const value: ParsedUpdateRecipient = { providedFields: [] };

  if (has(body, 'displayName')) {
    const displayName = validateDisplayName(body.displayName);
    if (!displayName.ok) {
      return fail('displayName must be 1–200 characters.', [
        { field: 'displayName', message: 'Invalid display name.' },
      ]);
    }
    value.displayName = displayName.value;
    value.providedFields.push('displayName');
  }

  if (has(body, 'email')) {
    const email = validateEmail(body.email);
    if (!email.ok) {
      return fail('email must be a valid email address.', [
        { field: 'email', message: 'Invalid email address.' },
      ]);
    }
    value.email = email.value;
    value.providedFields.push('email');
  }

  if (has(body, 'relationshipLabel')) {
    // Null clears the label; a string sets it.
    if (body.relationshipLabel === null) {
      value.relationshipLabel = null;
      value.providedFields.push('relationshipLabel');
    } else {
      const label = validateRelationshipLabel(body.relationshipLabel);
      if (!label.ok) {
        return fail('relationshipLabel must be 1–120 characters or null.', [
          { field: 'relationshipLabel', message: 'Invalid relationship label.' },
        ]);
      }
      value.relationshipLabel = label.value;
      value.providedFields.push('relationshipLabel');
    }
  }

  if (value.providedFields.length === 0) {
    return fail('At least one updatable field must be provided.');
  }

  return { ok: true, value };
}

export function assertRecipientId(
  recipientId: string,
): { ok: true } | { ok: false; response: NextResponse<ErrorResponse> } {
  if (!recipientId || recipientId.length > 64) {
    return {
      ok: false,
      response: jsonErrorResponse('VALIDATION_ERROR', 'recipientId is invalid.', 400),
    };
  }
  return { ok: true };
}
