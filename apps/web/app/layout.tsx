import type { Metadata } from 'next';
import './globals.css';

export const metadata: Metadata = {
  title: 'AI Communication Action Assistant',
  description: 'Repository foundation shell — no product features yet.',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
