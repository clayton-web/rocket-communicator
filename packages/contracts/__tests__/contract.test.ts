import { describe, expect, it } from 'vitest';
import { execSync } from 'node:child_process';
import { readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import Ajv from 'ajv';
import addFormats from 'ajv-formats';
import { parse as parseYaml } from 'yaml';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

describe('contracts package', () => {
  it('lints and bundles OpenAPI', () => {
    execSync('pnpm lint', { cwd: root, stdio: 'pipe' });
    execSync('pnpm bundle', { cwd: root, stdio: 'pipe' });
    const bundled = readFileSync(path.join(root, 'dist/openapi.bundled.yaml'), 'utf8');
    expect(bundled).toContain('/api/v1/session');
    expect(bundled).not.toContain('/health');
  });

  it('validates committed examples against bundled schemas', () => {
    execSync('pnpm bundle', { cwd: root, stdio: 'pipe' });
    const bundled = parseYaml(readFileSync(path.join(root, 'dist/openapi.bundled.yaml'), 'utf8'));
    const ajv = new Ajv({ strict: false, allErrors: true });
    addFormats(ajv);

    const schemas = bundled.components?.schemas ?? {};
    for (const [name, schema] of Object.entries(schemas)) {
      ajv.addSchema(schema as object, `#/components/schemas/${name}`);
    }

    const examplesDir = path.join(root, 'openapi/examples');
    const examples = readdirSync(examplesDir).filter((file) => file.endsWith('.json'));

    const suggestion = JSON.parse(
      readFileSync(path.join(examplesDir, 'task-suggestion-pending.json'), 'utf8'),
    );
    const validateSuggestion = ajv.getSchema('#/components/schemas/TaskSuggestion');
    expect(validateSuggestion?.(suggestion)).toBe(true);

    // Revision-evidence and accepted-revision internals must not leak into the public
    // TaskSuggestion contract (D155 inert foundation is persistence-only).
    const suggestionProperties = Object.keys(
      (schemas.TaskSuggestion as { properties?: Record<string, unknown> })?.properties ?? {},
    );
    for (const forbidden of [
      'revisions',
      'acceptedRevisionId',
      'acceptedRevision',
      'revisionNumber',
      'authorKind',
      'authoredByOwnerId',
      'interpretationRunId',
      'taskSuggestionRevisions',
    ]) {
      expect(suggestionProperties).not.toContain(forbidden);
    }
    expect(schemas.TaskSuggestionRevision).toBeUndefined();
    expect(schemas.TaskSuggestionRevisionAuthorKind).toBeUndefined();

    const complete = JSON.parse(
      readFileSync(path.join(examplesDir, 'task-complete-one-tap.json'), 'utf8'),
    );
    const validateComplete = ajv.getSchema('#/components/schemas/CompleteTaskRequest');
    expect(validateComplete?.(complete)).toBe(true);

    for (const file of examples.filter((name) => name.startsWith('error-'))) {
      const payload = JSON.parse(readFileSync(path.join(examplesDir, file), 'utf8'));
      const validateError = ajv.getSchema('#/components/schemas/ErrorResponse');
      expect(validateError?.(payload)).toBe(true);
    }

    expect(examples.length).toBeGreaterThanOrEqual(4);
  });

  it('contracts responsibility selection as a distinct approve concept (D168)', () => {
    execSync('pnpm bundle', { cwd: root, stdio: 'pipe' });
    const bundled = parseYaml(readFileSync(path.join(root, 'dist/openapi.bundled.yaml'), 'utf8'));
    const schemas = bundled.components?.schemas ?? {};

    const approve = schemas.ApproveTaskSuggestionRequest as {
      required?: string[];
      properties?: Record<
        string,
        { $ref?: string; allOf?: { $ref?: string }[]; description?: string }
      >;
    };
    // The selection is its own concept, never a reinterpretation of the legacy recipientId, which
    // keeps its D080 RECIPIENT_HANDOFF_NOT_AVAILABLE meaning.
    expect(approve.properties?.responsibility?.allOf?.[0]?.$ref).toBe(
      '#/components/schemas/ResponsibilitySelection',
    );
    // Required, so no successful acceptance can lack affirmative D168 evidence and no omitted
    // field can be read as an Owner selection (D155, D164).
    expect([...(approve.required ?? [])].sort()).toEqual(['acknowledgement', 'responsibility']);
    expect(approve.properties?.responsibility?.description).toMatch(
      /never defaulted or\s+inferred/i,
    );
    expect(approve.properties?.recipientId?.description).toContain(
      'RECIPIENT_HANDOFF_NOT_AVAILABLE',
    );

    const selection = schemas.ResponsibilitySelection as {
      required?: string[];
      properties?: Record<string, unknown>;
    };
    // responsibleParty is required, so an Owner selection is always affirmatively stated rather
    // than inferred from a missing Recipient (D155).
    expect(selection.required).toEqual(['responsibleParty']);
    expect(Object.keys(selection.properties ?? {}).sort()).toEqual([
      'recipientId',
      'responsibleParty',
    ]);
    expect((schemas.ResponsiblePartyKind as { enum?: string[] }).enum).toEqual([
      'owner',
      'recipient',
    ]);

    // The evidence carrier itself stays persistence-only: no public read schema, and no
    // responsibility/custody/assignee field on the Task or TaskSuggestion read contracts.
    // TaskSuggestion.approvedTaskId is the existing approval linkage for lost-response
    // recovery (S2) — not responsibility state — and is intentionally exposed on reads.
    for (const forbidden of [
      'ResponsibilitySelectionEvidence',
      'TaskResponsibility',
      'ResponsibilityHistory',
      'CurrentResponsibility',
    ]) {
      expect(schemas[forbidden]).toBeUndefined();
    }
    const suggestionProperties = Object.keys(
      (schemas.TaskSuggestion as { properties?: Record<string, unknown> })?.properties ?? {},
    );
    expect(suggestionProperties).toContain('approvedTaskId');
    for (const forbidden of ['responsibility', 'responsibleParty', 'custody', 'assigneeId']) {
      expect(suggestionProperties, `TaskSuggestion must not expose ${forbidden}`).not.toContain(
        forbidden,
      );
    }
    const taskProperties = Object.keys(
      (schemas.Task as { properties?: Record<string, unknown> })?.properties ?? {},
    );
    expect(taskProperties).toContain('dueAt');
    expect(taskProperties).toContain('dueLocalDate');
    expect(taskProperties).toContain('derivedUrgency');
    const dueLocalDate = (
      schemas.Task as {
        properties?: { dueLocalDate?: { oneOf?: Array<{ type?: string; pattern?: string }> } };
      }
    ).properties?.dueLocalDate;
    expect(dueLocalDate?.oneOf?.some((entry) => entry.pattern === '^\\d{4}-\\d{2}-\\d{2}$')).toBe(
      true,
    );
    expect(dueLocalDate?.oneOf?.some((entry) => entry.type === 'null')).toBe(true);
    for (const forbidden of [
      'responsibility',
      'responsibleParty',
      'custody',
      'assigneeId',
      'approvedTaskId',
    ]) {
      expect(taskProperties, `Task must not expose ${forbidden}`).not.toContain(forbidden);
    }
  });

  // Full generate includes OpenAPI bundle, TypeScript, and Kotlin (Java) codegen.
  // CI annotations showed Vitest's default 5s timeout failing this step.
  it('generates TypeScript output', () => {
    execSync('pnpm generate', { cwd: root, stdio: 'pipe' });
    const generated = readFileSync(path.join(root, 'generated/typescript/schema.ts'), 'utf8');
    expect(generated).toContain('TaskSuggestion');
    expect(generated).toContain('TaskStatus');
    expect(generated).toContain('GmailConnection');
    expect(generated).toContain('GmailSyncRun');
    expect(generated).toContain('GmailConnectionStatus');
    expect(generated).toContain('HandoffTaskRequest');
    expect(generated).toContain('HandoffTaskResponse');
    expect(generated).toContain('CreateRecipientRequest');
    expect(generated).toContain('CAPABILITY_NO_LONGER_ACTIVE');
    expect(generated).toContain('handoff_confirmed_v1');
  }, 120_000);

  it('keeps Gmail public schemas free of token and ciphertext fields', () => {
    execSync('pnpm bundle', { cwd: root, stdio: 'pipe' });
    const bundled = parseYaml(readFileSync(path.join(root, 'dist/openapi.bundled.yaml'), 'utf8'));
    const schemas = bundled.components?.schemas ?? {};
    const gmailSchemas = [
      'GmailConnection',
      'GmailDisconnectResponse',
      'GmailSyncRun',
      'GmailSyncResponse',
      'GmailPollResponse',
    ];
    const forbiddenPropertyNames =
      /^(refreshToken|accessToken|encryptedRefreshToken|encryptedAccessToken|encryptionKeyVersion|clientSecret|pkceVerifier|codeVerifier)$/i;
    for (const name of gmailSchemas) {
      const schema = schemas[name] as { properties?: Record<string, unknown> } | undefined;
      for (const propertyName of Object.keys(schema?.properties ?? {})) {
        expect(propertyName).not.toMatch(forbiddenPropertyNames);
      }
    }
    expect(bundled.paths?.['/api/v1/gmail/connection']).toBeDefined();
    expect(bundled.paths?.['/api/v1/internal/gmail/poll']).toBeDefined();
    expect(bundled.paths?.['/api/v1/tasks/{taskId}/handoff']).toBeDefined();
    expect(bundled.paths?.['/api/v1/recipients']).toBeDefined();
    expect(bundled.paths?.['/api/v1/recipients/{recipientId}/deactivate']).toBeDefined();
    expect(bundled.paths?.['/api/v1/communication-events']).toBeUndefined();
    expect(schemas.AssignmentDeliveryStatus).toBeDefined();
    const deliveryDesc = JSON.stringify(schemas.AssignmentDeliveryStatus);
    expect(deliveryDesc).toMatch(/real delivery model/i);
    expect(deliveryDesc).not.toMatch(/Placeholder for assignment email delivery tracking/i);
    expect(deliveryDesc).not.toMatch(/implementation deferred/i);
    expect(deliveryDesc).toMatch(/pending|sent|failed/);
    expect(schemas.HandoffTaskResponse).toBeDefined();
    const handoffProps = (schemas.HandoffTaskResponse as { properties?: Record<string, unknown> })
      .properties;
    expect(handoffProps?.token).toBeUndefined();
    expect(handoffProps?.capabilityId).toBeDefined();
    expect(schemas.ErrorCode).toBeDefined();
    const errorEnum = (schemas.ErrorCode as { enum?: string[] }).enum ?? [];
    expect(errorEnum).toContain('CAPABILITY_NO_LONGER_ACTIVE');
    expect(errorEnum).toContain('GMAIL_SEND_SCOPE_REQUIRED');
    expect(errorEnum).toContain('HANDOFF_DELIVERY_FAILED');
    const errorDesc = (schemas.ErrorCode as { description?: string }).description ?? '';
    expect(errorDesc).toMatch(/superseded/i);
    expect(errorDesc).toMatch(/UNAUTHORIZED/);
    expect(errorDesc).toMatch(/[Mm]anual/);
    expect(errorDesc).not.toMatch(/superseded\/revoked/i);
    expect(errorDesc).not.toMatch(/revoked\/superseded/i);
    const capabilityNoLongerActive = bundled.components?.responses?.CapabilityNoLongerActive as
      { description?: string } | undefined;
    const responseDesc = capabilityNoLongerActive?.description ?? '';
    expect(responseDesc).toMatch(/superseded/i);
    expect(responseDesc).toMatch(/UNAUTHORIZED/);
    expect(responseDesc).toMatch(/[Mm]anual/);
    expect(responseDesc).not.toMatch(/revoked\/superseded/i);
    expect(responseDesc).not.toMatch(/superseded\/revoked/i);
    const capabilityStatusDesc =
      (schemas.CapabilityStatus as { description?: string } | undefined)?.description ?? '';
    expect(capabilityStatusDesc).toMatch(/supersession/i);
    expect(capabilityStatusDesc).not.toMatch(/revoked\/superseded/i);
    expect(bundled.components?.parameters?.IdempotencyKey).toBeDefined();
    expect(schemas.GmailPollRequest).toBeUndefined();
    const pollPath = bundled.paths?.['/api/v1/internal/gmail/poll'];
    expect(pollPath?.get?.security).toEqual([{ InternalCronBearer: [] }]);
    expect(pollPath?.post?.security).toEqual([{ InternalCronBearer: [] }]);
    expect(bundled.components?.securitySchemes?.InternalCronBearer).toBeDefined();
  });

  it('exposes the A8.3b Owner reminder surface without worker internals', () => {
    execSync('pnpm bundle', { cwd: root, stdio: 'pipe' });
    const bundled = parseYaml(readFileSync(path.join(root, 'dist/openapi.bundled.yaml'), 'utf8'));
    const schemas = bundled.components?.schemas ?? {};

    const reminderPath = bundled.paths?.['/api/v1/tasks/{taskId}/reminder'];
    expect(reminderPath?.get?.operationId).toBe('getTaskReminder');
    expect(reminderPath?.put?.operationId).toBe('setTaskReminder');
    expect(reminderPath?.delete?.operationId).toBe('removeTaskReminder');

    // Reads need no precondition; both mutations run under the existing Task If-Match concurrency
    // required for Owner due-date mutation (D045, D104).
    const parameterNames = (operation: { parameters?: { $ref?: string }[] } | undefined) =>
      (operation?.parameters ?? []).map((parameter) => parameter.$ref ?? '');
    expect(parameterNames(reminderPath?.get).join()).not.toMatch(/IfMatch/);
    for (const operation of [reminderPath?.put, reminderPath?.delete]) {
      expect(parameterNames(operation).join()).toMatch(/IfMatch/);
      expect(Object.keys(operation?.responses ?? {})).toEqual(
        expect.arrayContaining(['412', '428']),
      );
    }

    // Owner-selectable inputs are the local due date and the optional D178 advance preference.
    // A reminder-time, preset-interval, recurrence, or timezone field would each contradict D102/D103.
    const requestProperties = Object.keys(
      (schemas.SetTaskReminderRequest as { properties?: Record<string, unknown> })?.properties ??
        {},
    );
    expect(requestProperties).toEqual(['dueLocalDate', 'advanceEnabled']);
    expect(
      (schemas.SetTaskReminderRequest as { additionalProperties?: boolean }).additionalProperties,
    ).toBe(false);
    expect((schemas.SetTaskReminderRequest as { required?: string[] }).required).toEqual([
      'dueLocalDate',
    ]);

    // Worker coordination state must never reach the Owner contract.
    const stateProperties = Object.keys(
      (schemas.TaskReminderState as { properties?: Record<string, unknown> })?.properties ?? {},
    );
    for (const forbidden of [
      'claimedBy',
      'claimedAt',
      'claimExpiresAt',
      'scheduleId',
      'attempts',
      'providerMessageId',
      'failureReason',
    ]) {
      expect(stateProperties).not.toContain(forbidden);
    }
    expect(stateProperties).toEqual(
      expect.arrayContaining([
        'taskId',
        'dueLocalDate',
        'schedulingTimeZone',
        'state',
        'generation',
        'advance',
        'nextOverdueOccurrence',
        'overdueDeliveredCount',
        'requiresOwnerAttention',
        'stopReason',
        'advanceEnabled',
      ]),
    );

    expect((schemas.TaskReminderScheduleState as { enum?: string[] }).enum).toEqual([
      'no_due_date',
      'not_scheduled',
      'active',
      'suspended_waiting',
      'stopped',
    ]);
    expect((schemas.TaskReminderStopReason as { enum?: string[] }).enum).toContain(
      'due_date_removed',
    );
    // `skipped_waiting_elapsed` is deliberately distinct from `skipped_window_elapsed`: one says the
    // Owner chose the date too late, the other that a Waiting period covered the advance morning
    // (A8 lifecycle audit H-2). Collapsing them would leave a client unable to say which happened.
    // A8.4a appends the four values occurrence processing can reach; the order is pinned so an
    // addition has to be a deliberate edit here rather than a silent contract widening.
    expect((schemas.TaskReminderAdvanceDisposition as { enum?: string[] }).enum).toEqual([
      'scheduled',
      'skipped_window_elapsed',
      'skipped_waiting_elapsed',
      'delivered',
      'skipped_not_eligible',
      'failed_permanent',
      'ambiguous',
      'not_enabled',
    ]);

    // Local calendar dates stay canonical text, never instants (D103, D109).
    const occurrenceProperties = (
      schemas.TaskReminderOccurrence as {
        properties?: Record<string, { format?: string; pattern?: string }>;
      }
    ).properties;
    expect(occurrenceProperties?.localDate?.pattern).toBe('^\\d{4}-\\d{2}-\\d{2}$');
    expect(occurrenceProperties?.localDate?.format).toBeUndefined();
    expect(occurrenceProperties?.at?.format).toBe('date-time');

    // Still no Owner-facing attempt history: delivery attempts are internal records, and exposing
    // them would contract the worker's row shape before the worker is finished.
    expect(bundled.paths?.['/api/v1/tasks/{taskId}/reminder/attempts']).toBeUndefined();
  });

  it('contracts the A8.4a processing endpoint as POST-only aggregates and nothing more', () => {
    execSync('pnpm bundle', { cwd: root, stdio: 'pipe' });
    const bundled = parseYaml(readFileSync(path.join(root, 'dist/openapi.bundled.yaml'), 'utf8'));
    const schemas = (bundled.components?.schemas ?? {}) as Record<string, unknown>;
    const processPath = bundled.paths?.['/api/v1/internal/reminders/process'] as
      Record<string, unknown> | undefined;

    expect(processPath).toBeDefined();

    // No `GET`. The Gmail poll accepts both verbs for historical reasons; this one must not, because
    // a scheduler misconfigured onto `GET` would be a side-effecting read.
    expect(Object.keys(processPath!).sort()).toEqual(['post']);

    // Cron bearer, never an Owner session.
    const post = processPath!.post as { security?: Array<Record<string, unknown>> };
    expect(post.security?.map((entry) => Object.keys(entry)[0])).toEqual(['InternalCronBearer']);

    // Aggregate counters only. A Recipient identity, address, provider payload, failure detail, or
    // claim internal appearing here would leak per-Task facts through an operational endpoint.
    const response = schemas.ReminderProcessResponse as {
      properties?: Record<string, unknown>;
      required?: string[];
    };
    expect(Object.keys(response.properties ?? {}).sort()).toEqual([
      // Schedules D129 stopped for three consecutive unconfirmable sends (A8.4b.2). A count, like
      // its neighbours: which Tasks they were is deliberately not reportable here.
      'ambiguityStops',
      'ambiguous',
      'ceilingStops',
      // Occurrences another worker held, or that no worker may claim again (A8.4a audit B2).
      'claimRefusals',
      // Whether the soft deadline cut the run short, so a persistently truncated run is visible.
      'deadlineStopped',
      'delivered',
      'deliveryEnabled',
      'failedPermanent',
      'failedRetryable',
      'occurrencesClaimed',
      'recoveredClaims',
      'requestId',
      // The three settlement counters (A8.4a audit H1). Between them an operator can tell a healthy
      // run from one repeatedly picking up debt it cannot discharge.
      'retryBudgetTerminalizations',
      'schedulesScanned',
      'settlementsDeferred',
      'skipped',
      // Three different reasons for a zero-work response, reported apart: the flag is off, no
      // transport was available (A8.4a audit H3), or authorization failed before the first claim
      // (A8.4b.1). An operator seeing zeros needs to know which.
      'transportAuthorized',
      'transportConfigured',
      'unsettledOccurrencesSettled',
    ]);
    // Every field is required, so a caller can never be handed a partial picture of a run.
    expect([...(response.required ?? [])].sort()).toEqual(
      Object.keys(response.properties ?? {}).sort(),
    );
  });

  it('contracts the S3.2 manual-capture route without interpretation provenance (D170)', () => {
    execSync('pnpm bundle', { cwd: root, stdio: 'pipe' });
    const bundled = parseYaml(readFileSync(path.join(root, 'dist/openapi.bundled.yaml'), 'utf8'));
    const schemas = (bundled.components?.schemas ?? {}) as Record<string, unknown>;
    const capturePath = bundled.paths?.['/api/v1/manual-captures'] as
      Record<string, unknown> | undefined;

    expect(capturePath).toBeDefined();
    // POST only. A readable capture collection would be a raw-input surface by another name.
    expect(Object.keys(capturePath!).sort()).toEqual(['post']);

    const post = capturePath!.post as {
      operationId?: string;
      parameters?: { $ref?: string }[];
      responses?: Record<string, unknown>;
    };
    expect(post.operationId).toBe('createManualCapture');
    // The existing reusable header contract, not a second idempotency parameter.
    expect((post.parameters ?? []).map((parameter) => parameter.$ref ?? '').join()).toMatch(
      /IdempotencyKey/,
    );
    expect(bundled.components?.parameters?.IdempotencyKey).toBeDefined();

    // 200 covers first success, replay, and zero proposals alike; 201/204 would each claim
    // something untrue about a replay or an empty result.
    expect(Object.keys(post.responses ?? {}).sort()).toEqual([
      '200',
      '400',
      '401',
      '409',
      '415',
      '428',
      '500',
      '503',
    ]);

    const request = schemas.CreateManualCaptureRequest as {
      additionalProperties?: boolean;
      required?: string[];
      properties?: Record<string, { maxLength?: number; minLength?: number }>;
    };
    expect(request.additionalProperties).toBe(false);
    // Exactly three inputs. `sourceKind` and `organizationId` are absent because the server decides
    // both; a client that could state them could spoof provenance or reach another organization.
    expect(Object.keys(request.properties ?? {}).sort()).toEqual([
      'capturedAt',
      'rawInput',
      'timezone',
    ]);
    expect([...(request.required ?? [])].sort()).toEqual(['capturedAt', 'rawInput']);
    expect(request.properties?.rawInput?.minLength).toBe(1);
    expect(request.properties?.rawInput?.maxLength).toBe(4000);

    const response = schemas.ManualCaptureResponse as {
      additionalProperties?: boolean;
      required?: string[];
      properties?: Record<string, { items?: { $ref?: string } }>;
    };
    expect(response.additionalProperties).toBe(false);
    expect(Object.keys(response.properties ?? {}).sort()).toEqual([
      'idempotentReplay',
      'interpretedAt',
      'taskSuggestions',
    ]);
    // Every field required, so a caller is never handed a partial result.
    expect([...(response.required ?? [])].sort()).toEqual(
      Object.keys(response.properties ?? {}).sort(),
    );
    // The canonical proposal schema is reused rather than copied into a second proposal DTO.
    expect(response.properties?.taskSuggestions?.items?.$ref).toBe(
      '#/components/schemas/TaskSuggestion',
    );

    // Interpretation provenance is persistence-only (D169). None of it may appear on the request,
    // the response, or the proposal schema the response returns — and no `rawInput` echo either.
    const forbiddenProvenance = [
      'interpretationRunId',
      'interpretationRun',
      'runId',
      'requestFingerprint',
      'fingerprint',
      'idempotencyKey',
      'modelVersion',
      'policyVersion',
      'sourceKind',
      'organizationId',
    ];
    for (const forbidden of forbiddenProvenance) {
      expect(
        Object.keys(response.properties ?? {}),
        `ManualCaptureResponse must not expose ${forbidden}`,
      ).not.toContain(forbidden);
      expect(
        Object.keys(request.properties ?? {}),
        `CreateManualCaptureRequest must not accept ${forbidden}`,
      ).not.toContain(forbidden);
    }
    expect(Object.keys(response.properties ?? {})).not.toContain('rawInput');

    const suggestionProperties = Object.keys(
      (schemas.TaskSuggestion as { properties?: Record<string, unknown> })?.properties ?? {},
    );
    for (const forbidden of [
      'interpretationRunId',
      'requestFingerprint',
      'idempotencyKey',
      'modelVersion',
      'policyVersion',
      'rawInput',
    ]) {
      expect(suggestionProperties, `TaskSuggestion must not expose ${forbidden}`).not.toContain(
        forbidden,
      );
    }

    // No InterpretationRun resource, and no second proposal DTO, entered the public contract.
    for (const forbidden of [
      'InterpretationRun',
      'InterpretationOccurrence',
      'ManualCaptureTaskSuggestion',
      'ProposedTask',
    ]) {
      expect(schemas[forbidden]).toBeUndefined();
    }

    // The route is manual capture only. A generic arbitrary-source interpretation endpoint would
    // let a client claim any provenance it liked, which is exactly what fixing it server-side
    // prevents. Gmail Review with Rocket is a separate Gmail-tag adapter (D179), not this route.
    const routes = Object.keys(bundled.paths ?? {});
    expect(routes).not.toContain('/api/v1/interpretations');
    expect(routes.filter((route) => route.includes('interpretation'))).toEqual([]);
    expect(routes.filter((route) => route.includes('capture'))).toEqual([
      '/api/v1/manual-captures',
    ]);

    // Existing provenance vocabulary is reused unchanged.
    expect((schemas.SourceType as { enum?: string[] }).enum).toContain('manual');
    const errorEnum = (schemas.ErrorCode as { enum?: string[] }).enum ?? [];
    for (const code of [
      'VALIDATION_ERROR',
      'UNAUTHORIZED',
      'IDEMPOTENCY_KEY_CONFLICT',
      'DOMAIN_CONFLICT',
      'PRECONDITION_REQUIRED',
      'DEPENDENCY_UNAVAILABLE',
      'INTERNAL_ERROR',
    ]) {
      expect(errorEnum).toContain(code);
    }
  });

  it('contracts the S7 Gmail intake and Review-with-Rocket adapter without a generic interpretations API (D179)', () => {
    execSync('pnpm bundle', { cwd: root, stdio: 'pipe' });
    const bundled = parseYaml(readFileSync(path.join(root, 'dist/openapi.bundled.yaml'), 'utf8'));
    const schemas = (bundled.components?.schemas ?? {}) as Record<string, unknown>;
    const routes = Object.keys(bundled.paths ?? {});

    expect(routes).toContain('/api/v1/gmail/intake');
    expect(routes).toContain('/api/v1/gmail/reviews');
    expect(routes).not.toContain('/api/v1/interpretations');
    expect(routes.filter((route) => route.includes('communication-event'))).toEqual([]);

    const intakePath = bundled.paths?.['/api/v1/gmail/intake'] as
      Record<string, unknown> | undefined;
    expect(Object.keys(intakePath ?? {}).sort()).toEqual(['get']);
    const intakeGet = intakePath!.get as {
      operationId?: string;
      parameters?: { $ref?: string }[];
      responses?: Record<string, unknown>;
    };
    expect(intakeGet.operationId).toBe('listGmailIntake');
    expect((intakeGet.parameters ?? []).map((parameter) => parameter.$ref ?? '').join()).toMatch(
      /Cursor/,
    );
    expect((intakeGet.parameters ?? []).map((parameter) => parameter.$ref ?? '').join()).toMatch(
      /Limit/,
    );
    expect(Object.keys(intakeGet.responses ?? {}).sort()).toEqual(['200', '400', '401', '500']);

    const item = schemas.GmailIntakeItem as {
      additionalProperties?: boolean;
      required?: string[];
      properties?: Record<string, unknown>;
    };
    expect(item.additionalProperties).toBe(false);
    expect(Object.keys(item.properties ?? {}).sort()).toEqual([
      'fromAddress',
      'id',
      'receivedAt',
      'snippet',
      'subject',
    ]);
    expect([...(item.required ?? [])].sort()).toEqual(['fromAddress', 'id', 'receivedAt']);
    for (const forbidden of [
      'organizationId',
      'accountId',
      'labelIds',
      'toAddresses',
      'excerpt',
      'content',
      'providerMessageId',
      'suggestionProcessingStatus',
      'sourceKind',
    ]) {
      expect(
        Object.keys(item.properties ?? {}),
        `GmailIntakeItem must not expose ${forbidden}`,
      ).not.toContain(forbidden);
    }

    const reviewPath = bundled.paths?.['/api/v1/gmail/reviews'] as
      Record<string, unknown> | undefined;
    expect(Object.keys(reviewPath ?? {}).sort()).toEqual(['post']);
    const reviewPost = reviewPath!.post as {
      operationId?: string;
      parameters?: { $ref?: string }[];
      responses?: Record<string, unknown>;
    };
    expect(reviewPost.operationId).toBe('createGmailReview');
    expect((reviewPost.parameters ?? []).map((parameter) => parameter.$ref ?? '').join()).toMatch(
      /IdempotencyKey/,
    );
    expect(Object.keys(reviewPost.responses ?? {}).sort()).toEqual([
      '200',
      '400',
      '401',
      '404',
      '409',
      '415',
      '428',
      '500',
      '503',
    ]);

    const request = schemas.CreateGmailReviewRequest as {
      additionalProperties?: boolean;
      required?: string[];
      properties?: Record<string, unknown>;
    };
    expect(request.additionalProperties).toBe(false);
    expect(Object.keys(request.properties ?? {}).sort()).toEqual(['communicationEventId']);
    expect(request.required).toEqual(['communicationEventId']);
    for (const forbidden of [
      'sourceKind',
      'organizationId',
      'rawInput',
      'capturedAt',
      'timezone',
      'excerpt',
    ]) {
      expect(
        Object.keys(request.properties ?? {}),
        `CreateGmailReviewRequest must not accept ${forbidden}`,
      ).not.toContain(forbidden);
    }

    const response = schemas.GmailReviewResponse as {
      additionalProperties?: boolean;
      required?: string[];
      properties?: Record<string, { items?: { $ref?: string } }>;
    };
    expect(response.additionalProperties).toBe(false);
    expect(Object.keys(response.properties ?? {}).sort()).toEqual([
      'idempotentReplay',
      'interpretedAt',
      'taskSuggestions',
    ]);
    expect([...(response.required ?? [])].sort()).toEqual(
      Object.keys(response.properties ?? {}).sort(),
    );
    expect(response.properties?.taskSuggestions?.items?.$ref).toBe(
      '#/components/schemas/TaskSuggestion',
    );
    for (const forbidden of [
      'interpretationRunId',
      'requestFingerprint',
      'idempotencyKey',
      'modelVersion',
      'policyVersion',
      'sourceKind',
      'rawInput',
      'excerpt',
    ]) {
      expect(
        Object.keys(response.properties ?? {}),
        `GmailReviewResponse must not expose ${forbidden}`,
      ).not.toContain(forbidden);
    }
  });

  it('contracts Gmail-specific sender exclusion without a generic communications exclusion API (D180)', () => {
    execSync('pnpm bundle', { cwd: root, stdio: 'pipe' });
    const bundled = parseYaml(readFileSync(path.join(root, 'dist/openapi.bundled.yaml'), 'utf8'));
    const schemas = (bundled.components?.schemas ?? {}) as Record<string, unknown>;
    const routes = Object.keys(bundled.paths ?? {});

    expect(routes).toContain('/api/v1/gmail/sender-exclusions');
    expect(routes).toContain('/api/v1/gmail/sender-exclusions/{exclusionId}');
    expect(routes).not.toContain('/api/v1/communications/exclusions');
    expect(routes.filter((route) => route.includes('communication-event'))).toEqual([]);
    expect(
      routes.filter((route) => route.includes('/exclusions') && !route.includes('gmail')),
    ).toEqual([]);

    const createPath = bundled.paths?.['/api/v1/gmail/sender-exclusions'] as
      Record<string, unknown> | undefined;
    expect(Object.keys(createPath ?? {}).sort()).toEqual(['post']);
    const createPost = createPath!.post as {
      operationId?: string;
      responses?: Record<string, unknown>;
    };
    expect(createPost.operationId).toBe('createGmailSenderExclusion');
    expect(Object.keys(createPost.responses ?? {}).sort()).toEqual([
      '200',
      '400',
      '401',
      '404',
      '415',
      '500',
    ]);

    const request = schemas.CreateGmailSenderExclusionRequest as {
      additionalProperties?: boolean;
      required?: string[];
      properties?: Record<string, unknown>;
    };
    expect(request.additionalProperties).toBe(false);
    expect(Object.keys(request.properties ?? {}).sort()).toEqual(['communicationEventId']);
    expect(request.required).toEqual(['communicationEventId']);
    for (const forbidden of [
      'fromAddress',
      'senderAddress',
      'email',
      'organizationId',
      'sourceKind',
      'rawInput',
    ]) {
      expect(
        Object.keys(request.properties ?? {}),
        `CreateGmailSenderExclusionRequest must not accept ${forbidden}`,
      ).not.toContain(forbidden);
    }

    const exclusion = schemas.GmailSenderExclusion as {
      additionalProperties?: boolean;
      required?: string[];
      properties?: Record<string, unknown>;
    };
    expect(exclusion.additionalProperties).toBe(false);
    expect(Object.keys(exclusion.properties ?? {}).sort()).toEqual(['createdAt', 'id']);
    expect([...(exclusion.required ?? [])].sort()).toEqual(['createdAt', 'id']);
    for (const forbidden of ['senderAddress', 'fromAddress', 'email', 'excerpt', 'content']) {
      expect(
        Object.keys(exclusion.properties ?? {}),
        `GmailSenderExclusion must not expose ${forbidden}`,
      ).not.toContain(forbidden);
    }

    const deletePath = bundled.paths?.['/api/v1/gmail/sender-exclusions/{exclusionId}'] as
      Record<string, unknown> | undefined;
    expect(Object.keys(deletePath ?? {}).sort()).toEqual(['delete']);
    const deleteOp = deletePath!.delete as { operationId?: string };
    expect(deleteOp.operationId).toBe('deleteGmailSenderExclusion');
  });

  it('has no stale generated Kotlin artifacts outside the generator manifest', () => {
    execSync('node scripts/cleanup-kotlin-orphans.mjs --check', { cwd: root, stdio: 'pipe' });
    const kotlinDocs = path.join(root, 'generated/kotlin/docs');
    expect(readFileSync(path.join(kotlinDocs, 'AuthenticatedRole.md'), 'utf8')).toContain('owner');
    expect(readFileSync(path.join(kotlinDocs, 'ReturnTaskToOwnerRequest.md'), 'utf8')).toContain(
      'ReturnTaskToOwnerRequest',
    );
  });

  it('contracts the notification endpoint as POST-only aggregates and nothing more', () => {
    execSync('pnpm bundle', { cwd: root, stdio: 'pipe' });
    const bundled = parseYaml(readFileSync(path.join(root, 'dist/openapi.bundled.yaml'), 'utf8'));
    const schemas = (bundled.components?.schemas ?? {}) as Record<string, unknown>;
    const processPath = bundled.paths?.['/api/v1/internal/notifications/process'] as
      Record<string, unknown> | undefined;

    expect(processPath).toBeDefined();

    // POST only, for the same reason the reminder worker is: a scheduler misconfigured onto `GET`
    // would be a side-effecting read.
    expect(Object.keys(processPath!).sort()).toEqual(['post']);

    const post = processPath!.post as { security?: Array<Record<string, unknown>> };
    expect(post.security?.map((entry) => Object.keys(entry)[0])).toEqual(['InternalCronBearer']);

    // Counts and flags only. An Owner or Recipient address, Task summary, actor label, event
    // subject, or provider payload appearing here would leak per-Task facts through an operational
    // endpoint (D109, D130).
    const response = schemas.NotificationProcessResponse as {
      properties?: Record<string, unknown>;
      required?: string[];
    };
    expect(Object.keys(response.properties ?? {}).sort()).toEqual([
      // Terminal on the first occurrence and never counted as sent (D135). Includes a lease that
      // lapsed after a provider call began.
      'ambiguous',
      // Whether the scan filled its batch. Not a count of remaining work, which would need an
      // unbounded count over every pending row.
      'batchFilled',
      // A8.5e: the capture phase's own gate, independent of delivery's.
      'captureEnabled',
      'claimed',
      // Invocation-level since A8.5e: true if either phase stopped taking new work for time.
      'deadlineStopped',
      'deliveryEnabled',
      // A8.5e capture phase, in counts and booleans like the delivery half. No capability
      // identifier and no individual expiry instant, which would name whose link lapsed and when.
      'expiryBatchFilled',
      'expiryDeadlineStopped',
      // Transitions another observer had already made. Normal under overlap, and not a failure.
      'expiryLostRaces',
      'expiryObserved',
      'expiryScanned',
      'failedPermanent',
      // Retryable with budget left; the intent returned to claimable work rather than settling.
      'failedRetryable',
      // Compare-and-set refusals. Expected under overlapping invocations, and not an error.
      'lostClaims',
      // Lapsed leases returned to claimable work because no provider call had started.
      'recoveredClaims',
      'requestId',
      'retryExhausted',
      'scanned',
      'sent',
      // The 24-hour horizon (D135), which is what stops a backlog from flushing.
      'staleSuppressed',
      // Two different reasons for a zero-work delivery half, reported apart: the flag is off, or
      // no transport could be composed. Since A8.5e a third is possible — capture used the whole
      // budget, so delivery never started and nothing was composed to begin with.
      'transportConfigured',
    ]);
    expect([...(response.required ?? [])].sort()).toEqual(
      Object.keys(response.properties ?? {}).sort(),
    );

    // No Owner-facing notification surface exists yet, and A8.5b adds none.
    const ownerFacing = Object.keys(bundled.paths ?? {}).filter(
      (route) => route.includes('notification') && !route.startsWith('/api/v1/internal/'),
    );
    expect(ownerFacing).toEqual([]);
  });
});
