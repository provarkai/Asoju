// No SiteHeader/.container here either — same reasoning as the landing
// page (app/page.tsx): login/register render their own full-width,
// two-panel brand layout. Split into its own group rather than reusing
// (portal) since these two pages are the only ones that need it.
export default function AuthLayout({ children }: { children: React.ReactNode }) {
  return <>{children}</>;
}
