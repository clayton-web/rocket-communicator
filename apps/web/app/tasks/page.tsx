import { getDb } from '@/lib/db/server';
import { listOwnerTasks } from '@/lib/tasks';
import { requireOwnerPage } from '@/lib/owner/require-owner-page';
import { TaskList } from './_components/task-list';

export const dynamic = 'force-dynamic';

export default async function TasksPage() {
  const authenticated = await requireOwnerPage('/tasks');
  const db = await getDb();
  const now = new Date().toISOString();
  const page = await listOwnerTasks({
    db,
    owner: authenticated.actor,
    now,
    limit: 25,
  });

  return <TaskList items={page.items} nextCursor={page.nextCursor} />;
}
