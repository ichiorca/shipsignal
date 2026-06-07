// T6 (spec 001) — root layout for the Vercel/v0 dashboard.
// P6 (WCAG 2.2 AA): declares the document language; a skip link gives keyboard users
// a way past the header straight to the main content on every page.

import type { ReactNode } from 'react';
import './globals.css';

export const metadata = {
  title: 'ShipSignal — Release runs',
  description: 'Release-to-content engine dashboard',
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en">
      <body>
        <a className="skip-link" href="#main">
          Skip to main content
        </a>
        <header>
          <nav aria-label="Primary">
            <strong>ShipSignal</strong>
          </nav>
        </header>
        {children}
      </body>
    </html>
  );
}
