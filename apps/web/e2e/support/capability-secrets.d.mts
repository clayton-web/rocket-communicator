/**
 * Types for the shared capability-secret constants.
 *
 * The implementation is plain `.mjs` so the TypeScript support helpers and the standalone
 * post-run sweep script share one definition of what a capability secret looks like.
 */

export declare const CAPABILITY_REDACTIONS: readonly { pattern: RegExp; replacement: string }[];

export declare const TOKEN_CANDIDATE: RegExp;

export declare const FINGERPRINT_FILE: string;

export declare const ARCHIVE_EXTENSIONS: readonly string[];
