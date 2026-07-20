import { notFound } from 'next/navigation';
import { getDb } from '@/lib/db/server';
import { getOwnerTask } from '@/lib/tasks';
import { listOwnerRecipients } from '@/lib/recipients';
import { getGmailConnection } from '@/lib/gmail/service';
import { requireOwnerPage } from '@/lib/owner/require-owner-page';
import { isTaskServiceError, readTaskServiceErrorCode } from '@/lib/errors/safe-error-shapes';
import { TaskDetail } from '../_components/task-detail';

export const dynamic = 'force-dynamic';

export default async function TaskDetailPage({ params }: { params: Promise<{ taskId: string }> }) {
  const { taskId } = await params;
  const authenticated = await requireOwnerPage(`/tasks/${taskId}`);
  const db = await getDb();
  const now = new Date().toISOString();

  let task;
  try {
    task = await getOwnerTask({
      db,
      owner: authenticated.actor,
      taskId,
      now,
    });
  } catch (error) {
    if (isTaskServiceError(error) && readTaskServiceErrorCode(error) === 'NOT_FOUND') {
      notFound();
    }
    throw error;
  }

  const [recipientsPage, connection] = await Promise.all([
    listOwnerRecipients({
      db,
      owner: authenticated.actor,
      cursor: null,
      limit: 25,
    }),
    getGmailConnection({ owner: authenticated.actor, db }),
  ]);

  return (
    <TaskDetail
      task={task}
      initialRecipients={recipientsPage.items}
      recipientsNextCursor={recipientsPage.nextCursor ?? null}
      initialConnection={connection}
    />
  );
}
