import Link from 'next/link';
import { getAuthenticatedOwner } from '@/lib/auth/require-owner';

export default async function HomePage() {
  const owner = await getAuthenticatedOwner();

  return (
    <main>
      <h1>AI Communication Action Assistant</h1>
      {owner ? (
        <>
          <p>Signed in as Owner.</p>
          <p>Display name: {owner.session.displayName}</p>
          <p className="status">
            <Link href="/tasks">Tasks</Link>
          </p>
        </>
      ) : (
        <>
          <p>Owner authentication is available.</p>
          <p className="status">
            <Link href="/login">Sign in with Google Workspace</Link>
          </p>
        </>
      )}
    </main>
  );
}
