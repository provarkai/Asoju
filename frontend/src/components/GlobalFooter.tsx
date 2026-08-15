import { SERVICE_FAMILIES } from '@/lib/services';

// GlobalFooter (Sprint 1 — same handoff section as GlobalHeader). Content
// is the same real, approved copy the homepage already carried — moved
// here and mounted globally in layout.tsx so it isn't duplicated on
// every page that wants it (design-system spec §22 "do not duplicate
// component markup ... when configuration can drive the same
// component"). Links now cover the six locked service routes instead of
// homepage in-page anchors, since this renders on every route, not just
// the marketing homepage.

export function GlobalFooter() {
  return (
    <div className="full-bleed landing-footer">
      <div className="landing-inner">
        <div className="landing-footer__inner">
          <div className="brand">
            ASOJU
            <small>Your trusted presence back home.</small>
          </div>
          <nav className="landing-footer__links" aria-label="Services">
            {SERVICE_FAMILIES.map((service) => (
              <a key={service.slug} href={`/${service.slug}`}>
                {service.name}
              </a>
            ))}
          </nav>
          <div className="muted">🏢 Lagos · Abuja &amp; environs</div>
        </div>
        <p className="landing-footer__disclaimer">
          ASOJU is a technology-enabled coordination &amp; execution platform, not a law firm,
          surveying firm or estate agency. All professional opinions come from appropriately
          licensed professionals.
        </p>
      </div>
    </div>
  );
}
