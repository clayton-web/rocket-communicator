import Link from 'next/link';

/**
 * Not-found state for any address the application does not serve (P1.5).
 *
 * Rendered outside the Owner route group, so it carries no Owner chrome, identity, or
 * sign-out control: an unmatched URL is reached by signed-out visitors and by Recipients
 * following a mistyped link, and neither should be shown an authenticated surface.
 *
 * The requested address is deliberately never echoed. A mistyped capability link still
 * contains a real capability token, and reflecting the path would print that secret into the
 * page, the browser history entry, and any screenshot of it (D114).
 *
 * A capability token that is merely unknown or expired does not reach this page. `/c/{token}`
 * matches its route and answers with the existing generic capability-unavailable view, which
 * is the more conservative presentation and stays that way.
 */
export default function NotFound() {
  return (
    <main>
      <h1>Page not found</h1>
      <p>The AI Communication Action Assistant does not serve this address.</p>
      <p>The link may be mistyped, or it may point to something that no longer exists.</p>
      <p className="status">
        <Link href="/">Return to the application</Link>
      </p>
    </main>
  );
}
