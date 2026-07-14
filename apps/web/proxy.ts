import { NextResponse, type NextRequest } from 'next/server';
import { AuthConfigError } from '@/lib/auth/errors';
import { createProxyClient } from '@/lib/supabase/proxy';

function withCapabilityPageHeaders(response: NextResponse): NextResponse {
  response.headers.set('Cache-Control', 'private, no-store, no-cache, must-revalidate');
  response.headers.set('Referrer-Policy', 'no-referrer');
  response.headers.set('X-Robots-Tag', 'noindex, nofollow, noarchive');
  return response;
}

export async function proxy(request: NextRequest) {
  // Recipient capability pages use path-token authorization only.
  // Skip Owner session refresh so opening /c/[token] never creates or requires a session.
  if (request.nextUrl.pathname.startsWith('/c/')) {
    return withCapabilityPageHeaders(NextResponse.next({ request }));
  }

  let response = NextResponse.next({ request });

  try {
    const supabase = createProxyClient(request, response);
    await supabase.auth.getUser();
  } catch (error) {
    if (error instanceof AuthConfigError) {
      return NextResponse.json(
        {
          error: {
            code: 'INTERNAL_ERROR',
            message: error.message,
            requestId: crypto.randomUUID(),
            correlationId: null,
          },
        },
        { status: 500 },
      );
    }
    throw error;
  }

  return response;
}

export const config = {
  matcher: ['/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)'],
};
