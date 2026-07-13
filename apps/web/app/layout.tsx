import type { Metadata } from 'next';
import './globals.css';

export const metadata: Metadata = {
  title: 'AI Communication Action Assistant',
  description: 'Owner authentication shell for the AI Communication Action Assistant.',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
