/**
 * Types for the shared database/cluster guard.
 *
 * The implementation is plain `.mjs` so the TypeScript harness and the standalone `.mjs`
 * lifecycle and fixture scripts share one copy; this declaration gives the TypeScript side
 * the same checking it would get from a `.ts` source.
 */

export declare function assertLocalDatabaseUrl(rawUrl: unknown, label?: string): void;

export declare function assertLocalClusterTarget(target: {
  socketDir: string;
  database: string;
  port: string;
  pgData: string;
}): void;
