import { NextResponse } from 'next/server';
import { AuthConfigError } from '@/lib/auth/errors';
import { getAuthConfig } from '@/lib/auth/config';
import { isWorkspaceDomainPermitted, workspaceIdentityFromUser } from '@/lib/auth/domain-allowlist';
import { internalErrorResponse } from '@/lib/auth/http';
import { resolveSafeNextPath } from '@/lib/auth/safe-next-path';
import { createClient } from '@/lib/supabase/server';

export async function GET(request: Request) {
  const requestUrl = new URL(request.url);
  const code = requestUrl.searchParams.get('code');
  const nextPath = resolveSafeNextPath(requestUrl.searchParams.get('next'), '/');

  if (!code) {
    return NextResponse.redirect(new URL('/login?error=missing_code', requestUrl.origin));
  }

  try {
    const config = getAuthConfig();
    const supabase = await createClient();
    const { error: exchangeError } = await supabase.auth.exchangeCodeForSession(code);

    if (exchangeError) {
      return NextResponse.redirect(new URL('/login?error=auth_failed', requestUrl.origin));
    }

    const {
      data: { user },
      error: userError,
    } = await supabase.auth.getUser();

    if (userError || !user) {
      await supabase.auth.signOut();
      return NextResponse.redirect(new URL('/login?error=auth_failed', requestUrl.origin));
    }

    const allowlist = isWorkspaceDomainPermitted(
      workspaceIdentityFromUser(user),
      config.ownerWorkspaceDomain,
    );

    if (!allowlist.permitted) {
      await supabase.auth.signOut();
      return NextResponse.redirect(new URL('/login?error=unauthorized_domain', requestUrl.origin));
    }

    return NextResponse.redirect(new URL(nextPath, config.appUrl));
  } catch (error) {
    if (error instanceof AuthConfigError) {
      return internalErrorResponse(error.message);
    }
    throw error;
  }
}
