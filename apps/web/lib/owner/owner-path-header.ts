/**
 * Internal request header carrying the requested Owner pathname (P1.5).
 *
 * Routing context and nothing else. It says which URL was asked for; it says nothing about
 * who asked, and no consumer may treat it as authentication or authorization evidence.
 *
 * It exists because the App Router gives a layout no access to the requested path, and the
 * Owner shell gate has to know that path *before* anything streams in order to send an
 * unauthenticated visitor back to where they were going. The proxy derives the value from
 * the URL it is handling and discards any inbound value, so what arrives here is a fact
 * about routing rather than a caller assertion — and it is still validated again through
 * `resolveSafeNextPath` before it can become a redirect target.
 *
 * Deliberately free of `server-only` and of any Node or React dependency: `proxy.ts` runs
 * outside the React server and has to import the same constant and matcher that the layout
 * consumes, because two copies of this rule could drift apart.
 */
export const OWNER_PATH_HEADER = 'x-aicaa-owner-path';

/** Owner document routes with no dynamic segment. */
const STATIC_OWNER_DOCUMENT_PATHS = new Set(['/tasks', '/attention']);

/**
 * `/tasks/{taskId}` with a single segment drawn from the URL-unreserved character set.
 *
 * Task ids are opaque branded strings with no validated format, so rather than guess their
 * shape this admits only characters that cannot encode a path separator, a backslash, a
 * scheme, or a control character. `%2F`, `%5C`, and anything deeper than one segment fail to
 * match and carry no header at all, which degrades to the page-level gate rather than
 * producing a return path pointing somewhere other than the request.
 */
const TASK_DETAIL_PATH = /^\/tasks\/([A-Za-z0-9._~-]+)$/;

/**
 * The return path for an Owner document request, or `null` for every other route.
 *
 * Derived only from a pathname, which excludes the query string and fragment: a return path
 * is for getting the Owner back to a page, and replaying their query parameters through a
 * login redirect would widen what the header carries for no benefit.
 */
export function ownerDocumentPath(pathname: string): string | null {
  if (STATIC_OWNER_DOCUMENT_PATHS.has(pathname)) {
    return pathname;
  }

  const detail = TASK_DETAIL_PATH.exec(pathname);
  if (!detail) {
    return null;
  }
  // Relative segments would resolve to a different page than the one requested.
  if (detail[1] === '.' || detail[1] === '..') {
    return null;
  }
  return pathname;
}
