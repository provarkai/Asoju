import { SiteHeader } from '@/components/SiteHeader';

// Every route under (portal)/ keeps the exact chrome the whole app used
// to get unconditionally from the root layout — SiteHeader + the
// 880px-centered .container. Split out so the top-level landing page
// (app/page.tsx) can render its own full-width marketing chrome instead
// without disturbing any of these routes: same URLs, same behavior,
// route groups are purely a layout-scoping device (don't appear in the
// path).
export default function PortalLayout({ children }: { children: React.ReactNode }) {
  return (
    <>
      <SiteHeader />
      <main className="container">{children}</main>
    </>
  );
}
