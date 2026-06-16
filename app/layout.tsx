// Root layout — the app shell. Mirrors the peer app (hindsight-guild): a persistent left sidebar
// (grouped sections) + a main column with a slim topbar. P6 (WCAG 2.2 AA): document language, a
// skip link straight to the page <main>, and a single landmark structure.

import type { ReactNode } from 'react';
import './globals.css';
import { Sidebar } from '@/app/components/Sidebar.ts';
import { ReviewerBadge } from '@/app/components/ReviewerBadge.ts';

export const metadata = {
  title: 'ShipSignal',
  description: 'Release-to-content engine',
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en">
      <head>
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="" />
        <link
          href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&family=Source+Serif+4:opsz,wght@8..60,400;8..60,500;8..60,600;8..60,700&family=JetBrains+Mono:wght@400;500&display=swap"
          rel="stylesheet"
        />
      </head>
      <body>
        <a className="skip-link" href="#main">
          Skip to main content
        </a>
        <div data-app-shell>
          <Sidebar />
          <div data-app-content>
            <header data-topbar>
              <ReviewerBadge />
            </header>
            {children}
          </div>
        </div>
      </body>
    </html>
  );
}
