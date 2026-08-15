import type { Metadata } from 'next';
import { SiteHeader } from '@/components/SiteHeader';
import { GlobalFooter } from '@/components/GlobalFooter';
import { ToastProvider } from '@/components/ui/Toast';
import './globals.css';

export const metadata: Metadata = {
  title: 'ASOJU — Your trusted presence back home',
  description:
    'ASOJU helps Nigerians abroad verify, manage and execute important tasks in Nigeria without being physically present.',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>
        <ToastProvider>
          <SiteHeader />
          <main className="container">{children}</main>
          <GlobalFooter />
        </ToastProvider>
      </body>
    </html>
  );
}
