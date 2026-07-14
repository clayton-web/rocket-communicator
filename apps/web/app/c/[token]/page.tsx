import type { Metadata } from 'next';
import { CapabilityUnavailableView, RecipientCapabilityPanel } from './recipient-capability-panel';
import { loadCapabilityPageView } from '@/lib/capability/page-load';

export const dynamic = 'force-dynamic';
export const revalidate = 0;
export const fetchCache = 'force-no-store';

export const metadata: Metadata = {
  title: 'Assigned task',
  description: 'Capability link for an assigned task.',
  robots: {
    index: false,
    follow: false,
    nocache: true,
    googleBot: {
      index: false,
      follow: false,
      noimageindex: true,
    },
  },
  referrer: 'no-referrer',
};

/**
 * GET /c/[token] — minimal non-mutating Recipient capability page (D050, D059).
 * Authorization is possession of the path token only.
 */
export default async function CapabilityTokenPage({
  params,
}: {
  params: Promise<{ token: string }>;
}) {
  const { token } = await params;
  const view = await loadCapabilityPageView(token);

  if (!view.ok) {
    return <CapabilityUnavailableView />;
  }

  return (
    <RecipientCapabilityPanel
      token={token}
      initialTask={view.task}
      permittedActions={view.permittedActions}
      expiresAt={view.expiresAt}
    />
  );
}
