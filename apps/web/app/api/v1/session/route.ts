import { AuthConfigError } from '@/lib/auth/errors';
import { internalErrorResponse, unauthorizedResponse } from '@/lib/auth/http';
import { requireOwnerSession } from '@/lib/auth/require-owner';

export async function GET() {
  try {
    const session = await requireOwnerSession();
    if (!session) {
      return unauthorizedResponse();
    }

    return Response.json(session);
  } catch (error) {
    if (error instanceof AuthConfigError) {
      return internalErrorResponse(error.message);
    }
    throw error;
  }
}
