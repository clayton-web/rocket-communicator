import type { APIRequestContext } from '@playwright/test';

/**
 * Owner API helpers used only to build fixtures and to make server-side assertions.
 *
 * Every call goes through the real authenticated Owner HTTP surface, so fixtures exercise
 * real business rules (If-Match, validation, audit) instead of writing rows behind them.
 */

export interface SeededTask {
  id: string;
  etag: string;
  status: string;
}

export interface SeededRecipient {
  id: string;
  displayName: string;
  email: string;
}

export interface IssuedCapability {
  capabilityId: string;
  taskId: string;
  assignmentId: string;
  expiresAt: string;
  /** Raw token. Never log, never place in a test title, never write to an artifact. */
  token: string;
  capabilityPath: string;
}

async function expectOk(response: { ok(): boolean; status(): number; text(): Promise<string> }) {
  if (!response.ok()) {
    throw new Error(`Fixture request failed with ${response.status()}: ${await response.text()}`);
  }
}

export function textSummaryPoint(label: string, value: string) {
  return {
    id: crypto.randomUUID(),
    kind: 'confirmed_fact' as const,
    label,
    order: 1,
    value,
  };
}

export async function createTask(
  request: APIRequestContext,
  label: string,
  value = 'Controlled P1.2 fixture task.',
): Promise<SeededTask> {
  const response = await request.post('/api/v1/tasks', {
    headers: { 'Content-Type': 'application/json' },
    data: { summaryPoints: [textSummaryPoint(label, value)] },
  });
  await expectOk(response);
  return (await response.json()) as SeededTask;
}

export async function getTask(request: APIRequestContext, taskId: string): Promise<SeededTask> {
  const response = await request.get(`/api/v1/tasks/${taskId}`);
  await expectOk(response);
  return (await response.json()) as SeededTask;
}

export async function createRecipient(
  request: APIRequestContext,
  displayName: string,
  email: string,
): Promise<SeededRecipient> {
  const response = await request.post('/api/v1/recipients', {
    headers: { 'Content-Type': 'application/json' },
    data: { displayName, email },
  });
  await expectOk(response);
  return (await response.json()) as SeededRecipient;
}

export async function addOwnerNote(
  request: APIRequestContext,
  task: SeededTask,
  body: string,
): Promise<SeededTask> {
  const response = await request.post(`/api/v1/tasks/${task.id}/notes`, {
    headers: { 'Content-Type': 'application/json', 'If-Match': task.etag },
    data: { body },
  });
  await expectOk(response);
  return getTask(request, task.id);
}

export async function completeTask(
  request: APIRequestContext,
  task: SeededTask,
  outcomeType: string,
  note?: string,
): Promise<SeededTask> {
  const response = await request.post(`/api/v1/tasks/${task.id}/complete`, {
    headers: { 'Content-Type': 'application/json', 'If-Match': task.etag },
    data: note === undefined ? { outcomeType } : { outcomeType, note },
  });
  await expectOk(response);
  return getTask(request, task.id);
}

/**
 * Issue a Recipient capability through the real A4 Owner issuance route.
 * The raw token is returned exactly once and must stay out of every retained artifact.
 */
export async function issueCapability(
  request: APIRequestContext,
  task: SeededTask,
): Promise<IssuedCapability> {
  const response = await request.post(`/api/v1/tasks/${task.id}/capabilities`, {
    headers: { 'If-Match': task.etag },
  });
  await expectOk(response);
  return (await response.json()) as IssuedCapability;
}
