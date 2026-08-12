import { NextResponse } from 'next/server';
import {
  parseIdempotencyKey,
  readJsonBody,
  requireJsonContentType,
  requireObjectBody,
} from '@/lib/http/request';
import { mapManualCaptureResponse } from '@/lib/interpretation/map-to-dto';
import { runOwnerInterpretationRoute } from '@/lib/interpretation/route-context';
import { interpretCapture } from '@/lib/interpretation/service';
import { parseManualCaptureBody } from '@/lib/interpretation/validate-body';

const NO_STORE = { 'Cache-Control': 'no-store' } as const;

/**
 * The only interpretation provenance this route can produce (D169, D170).
 *
 * Fixed as a server constant rather than read from the request, so provenance is a property of
 * which endpoint was called instead of a claim the caller makes. A future authorized Gmail or SMS
 * adapter states its own kind at its own route; there is deliberately no generic
 * arbitrary-source interpretation endpoint for a client to point anywhere it likes.
 */
const OWNER_MANUAL_CAPTURE = 'owner_manual_capture' as const;

/**
 * POST /api/v1/manual-captures
 *
 * Thin Owner-authenticated adapter over the S3.1 shared interpretation service (D169, D170).
 * Performs only: auth/organization scope, content-type, Idempotency-Key parse, body validation,
 * server-fixed source kind, one service call, canonical DTO mapping, and the public response.
 *
 * Everything that decides what actually happened stays in S3.1: request fingerprinting, idempotency
 * resolution, the provider call, the occurrence transaction, and proposal persistence. That is why
 * an exact replay costs no provider call and why this file has no notion of what a fingerprint is.
 *
 * `rawInput` lives only in this function's arguments. It is not persisted, not echoed back, not
 * placed in validation details, and not logged — the shared diagnostics record is an allowlist of
 * route template, operation, request id, duration, and outcome (D114), with no body on it.
 *
 * HTTP 200 answers first success, exact replay, and zero proposals alike. No canonical Task is
 * created, nothing is approved, no responsibility is chosen, and no assignment is written.
 */
export async function POST(request: Request) {
  return runOwnerInterpretationRoute(request, async (ctx) => {
    const contentType = requireJsonContentType(request);
    if (!contentType.ok) {
      return withNoStore(contentType.response);
    }

    const idempotency = parseIdempotencyKey(request);
    if (!idempotency.ok) {
      return withNoStore(idempotency.response);
    }

    const json = await readJsonBody(request);
    if (!json.ok) {
      return withNoStore(json.response);
    }
    const object = requireObjectBody(json.body);
    if (!object.ok) {
      return withNoStore(object.response);
    }
    const body = parseManualCaptureBody(object.value);
    if (!body.ok) {
      return withNoStore(body.response);
    }

    const result = await interpretCapture({
      db: ctx.db,
      request: {
        // Organization comes from the authenticated session only; the body has no field for it.
        organizationId: ctx.owner.organizationId,
        sourceKind: OWNER_MANUAL_CAPTURE,
        rawInput: body.value.rawInput,
        idempotencyKey: idempotency.value,
        requestId: ctx.requestId,
        // Caller-supplied capture time. Instant semantics and canonicalization belong to the
        // service, which fingerprints it; the server clock never substitutes for it.
        capturedAt: body.value.capturedAt,
        timezone: body.value.timezone,
      },
      now: ctx.now,
    });

    return NextResponse.json(mapManualCaptureResponse(result), {
      status: 200,
      headers: NO_STORE,
    });
  });
}

function withNoStore(response: Response): Response {
  response.headers.set('Cache-Control', 'no-store');
  return response;
}
