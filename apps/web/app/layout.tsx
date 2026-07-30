import type { Metadata, Viewport } from 'next';
// Tokens first: `globals.css` and every CSS module resolve `--aicaa-*` from here (D116).
import '@aicaa/ui/tokens.css';
import './globals.css';

export const metadata: Metadata = {
  title: 'AI Communication Action Assistant',
  description: 'Owner authentication shell for the AI Communication Action Assistant.',
};

/**
 * Added in P1.4. Without this, mobile browsers assume a desktop-width viewport and scale the
 * page down, which made every touch target smaller than its declared size no matter what the
 * stylesheet asked for.
 *
 * `maximumScale` and `userScalable` are deliberately left at their defaults so pinch-zoom
 * keeps working; capping it is an accessibility regression, not a polish step.
 */
export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
  // Lets the shell's `env(safe-area-inset-*)` gutters actually receive inset values.
  viewportFit: 'cover',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
