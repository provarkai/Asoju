import type { Metadata } from 'next';
import { Fraunces, Inter } from 'next/font/google';
import './globals.css';

export const metadata: Metadata = {
  title: 'ASOJU — Your trusted rep back home',
  description:
    'ASOJU helps Nigerians abroad verify, manage and execute important tasks in Nigeria without being physically present.',
};

// .variable only (never .className) — this exposes --font-display /
// --font-sans as CSS custom properties without touching font-family
// anywhere by itself. Nothing renders in these fonts unless a page
// explicitly opts in via those variables (see globals.css's .aam-page
// h1/h2/h3 rule) — every page not part of the asoju-app-main conversion
// keeps its existing system-font body copy untouched.
const fraunces = Fraunces({ subsets: ['latin'], variable: '--font-display-fraunces' });
const inter = Inter({ subsets: ['latin'], variable: '--font-sans-inter' });

// Deliberately minimal — no SiteHeader/.container here. Every route
// except the top-level landing page (app/page.tsx) lives under the
// (portal) route group, which supplies that shared chrome itself (see
// app/(portal)/layout.tsx). The landing page renders its own full-width
// marketing header/footer instead of the portal's.
export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={`${fraunces.variable} ${inter.variable}`}>
      <body>{children}</body>
    </html>
  );
}
