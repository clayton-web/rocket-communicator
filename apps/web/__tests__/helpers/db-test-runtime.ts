import type { DbClient } from '@aicaa/db';
import * as aicaaDb from '@aicaa/db';
import { resetDbRuntimeForTests, setDbRuntimeForTests } from '@/lib/db/runtime-db';
import { setDbForTests } from '@/lib/db/server';

export function installDbTestRuntime(db: DbClient): void {
  setDbRuntimeForTests(aicaaDb);
  setDbForTests(db);
}

export function clearDbTestRuntime(): void {
  setDbForTests(undefined);
  resetDbRuntimeForTests();
}
