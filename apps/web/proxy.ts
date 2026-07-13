import { NextResponse, type NextRequest } from 'next/server';
import { AuthConfigError } from '@/lib/auth/errors';
import { createProxyClient } from '@/lib/supabase/proxy';

export async function proxy(request: NextRequest) {
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
