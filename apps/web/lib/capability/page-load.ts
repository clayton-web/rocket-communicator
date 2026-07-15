import type { CapabilityAction, UtcInstant } from '@aicaa/domain';
import { getDb } from '@/lib/db/server';
import { getCapabilityTokenConfig } from './config';
import { mapTaskToDto, type TaskDto } from './map-to-dto';
import { mapRecipientServiceError } from './internal';
import { validateCapabilityToken } from './validate';

export type CapabilityPageView =
  | {
      ok: true;
      task: TaskDto;
      /** Issued capability scope (may be narrower than assignment actions). */
      permittedActions: CapabilityAction[];
      expiresAt: UtcInstant;
    }
  | {
      ok: false;
      /** Public-facing undifferentiated unavailable state. */
      reason: 'unavailable';
    };

/**
 * Server-only loader for GET /c/[token].
 * Resolves the bound task from token hash via Phase 3 validation (no taskId in the URL).
 * Strictly non-mutating: mode `get`, no audit, no expiry persist, no `used` transition.
 */
export async function loadCapabilityPageView(
  rawToken: string,
  now: UtcInstant = new Date().toISOString(),
): Promise<CapabilityPageView> {
  try {
    const token = rawToken.trim();
    if (token.length < 32 || token.length > 256) {
      return { ok: false, reason: 'unavailable' };
    }

    const { pepper } = getCapabilityTokenConfig();
    const ctx = await validateCapabilityToken({
      db: await getDb(),
      rawToken: token,
      pepper,
      now,
      action: 'view_assigned_task',
      mode: 'get',
    });

    return {
      ok: true,
      task: mapTaskToDto(ctx.task, now),
      permittedActions: [...ctx.capability.scope],
      expiresAt: ctx.capability.expiresAt,
    };
  } catch (error) {
    try {
      mapRecipientServiceError(error);
    } catch {
      // Collapse all capability/authz failures to one public unavailable state.
    }
    return { ok: false, reason: 'unavailable' };
  }
}
