'use client';

/**
 * Error boundary for every route outside the Owner group (P1.5): `/`, `/login`, and
 * `/c/{token}`.
 *
 * These pages are reached by people who are not signed in, including Recipients following a
 * capability link, so this boundary deliberately carries no Owner chrome, no identity, and no
 * invitation to sign in. It offers a retry and nothing that would only make sense to an Owner.
 *
 * `/c/{token}` reaches this boundary only when something genuinely unexpected throws. A token
 * that is unknown, expired, or already consumed is not an error: `loadCapabilityPageView`
 * reports it as an ordinary result and the page renders the existing generic
 * capability-unavailable view, which stays the presentation for that case.
 *
 * The requested address is never echoed, because on `/c/{token}` it contains a live
 * capability token (D114). Neither is the raw error, its stack, or any Task value; only the
 * framework's `digest` hash, which correlates with the server log.
 */
export default function RootError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return (
    <main>
      <h1>This page could not be displayed</h1>
      <p role="alert">A service this page depends on did not respond.</p>
      <p>Retry loading it. If it keeps failing, it needs operator attention.</p>
      <p className="status">
        <button type="button" onClick={reset}>
          Retry
        </button>
      </p>
      {error.digest ? <p>Reference for server logs: {error.digest}</p> : null}
    </main>
  );
}
