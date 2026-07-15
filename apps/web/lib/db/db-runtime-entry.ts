import 'server-only';

/**
 * Production DB runtime bridge.
 *
 * Resolved at build time via a relative import into traced packages/db/dist output.
 * Production Lambda code must not resolve the workspace package name at runtime.
 */
export * from '../../../../packages/db/dist/runtime.js';
