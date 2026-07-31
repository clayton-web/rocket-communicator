#!/usr/bin/env node
/**
 * Refuse Prisma CLI against non-loopback hosts when using local Docker helpers.
 * Prevents packages/db/.env (often a Supabase pooler URL) from being used by accident.
 */
import { pathToFileURL } from 'node:url';

const LOOPBACK = new Set(['127.0.0.1', 'localhost', '::1', '[::1]']);

export function assertLocalDatabaseUrl(raw) {
  if (typeof raw !== 'string' || raw.trim() === '') {
    throw new Error('DATABASE_URL is required for local Docker database commands.');
  }

  let url;
  try {
    url = new URL(raw);
  } catch {
    throw new Error('DATABASE_URL is not a valid URL.');
  }

  const protocol = url.protocol.toLowerCase();
  if (protocol !== 'postgresql:' && protocol !== 'postgres:') {
    throw new Error(`DATABASE_URL must use postgres/postgresql (got ${url.protocol}).`);
  }

  const host = url.hostname.toLowerCase();
  if (!LOOPBACK.has(host)) {
    throw new Error(
      `Refusing local database command: host "${url.hostname}" is not loopback. ` +
        'Local Docker helpers only accept 127.0.0.1 / localhost. ' +
        'Production migrate:deploy must be run intentionally with an explicit production DATABASE_URL — not via db:*:local scripts.',
    );
  }

  for (const key of ['host', 'hostaddr', 'socket']) {
    if (url.searchParams.has(key)) {
      throw new Error(
        `Refusing local database command: query parameter "${key}" is not allowed (could redirect off loopback).`,
      );
    }
  }
}

const isDirectRun = process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;

if (isDirectRun) {
  try {
    assertLocalDatabaseUrl(process.env.DATABASE_URL);
  } catch (error) {
    console.error(error instanceof Error ? error.message : error);
    process.exit(1);
  }
}
