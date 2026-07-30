'use client';

// `global-error.tsx` replaces the root layout, so the stylesheets that layout imports are
// not applied here. Importing them directly is what keeps the last-resort page branded
// rather than unstyled browser default text (D116).
import '@aicaa/ui/tokens.css';
import './globals.css';

/**
 * Last-resort fallback for a failure in the root layout itself (P1.5).
 *
 * Every other boundary renders inside the root layout. When the root layout is what failed
 * there is no layout left to render into, so this file supplies its own `<html>` and
 * `<body>`, as Next.js requires.
 *
 * It is deliberately self-contained: no Owner authentication, no Owner shell, no server-only
 * module, and no database import. Anything it depended on could be the thing that just broke,
 * and a fallback that can fail for the same reason as the page is not a fallback.
 *
 * The copy states only what is known. A root-layout failure says nothing about whether an
 * earlier request completed, so this page makes no claim about saved, queued, or preserved
 * work. `digest` is a framework-generated hash that correlates with the server log; the raw
 * error, its stack, and every session, token, and Task value stay on the server.
 */
export default function GlobalError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return (
    <html lang="en">
      <body>
        <main>
          <h1>AI Communication Action Assistant</h1>
          <p role="alert">This page could not be displayed.</p>
          <p>
            Retry loading it. If it keeps failing, the deployment needs operator attention before
            the application can be used.
          </p>
          <p className="status">
            <button type="button" onClick={reset}>
              Retry
            </button>
          </p>
          {error.digest ? <p>Reference for server logs: {error.digest}</p> : null}
        </main>
      </body>
    </html>
  );
}
