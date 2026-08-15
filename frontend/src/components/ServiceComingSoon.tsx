import Link from 'next/link';
import { ServiceFamily } from '@/lib/services';

// Placeholder for the six locked service routes so the Sprint 1
// GlobalHeader menu has somewhere real to link to. This is deliberately
// NOT the full service page — that's Sprint 5 (shared service-page shell)
// and Sprint 6 (populate all six) in docs/frontend-handoff-v1.0/
// 05_Implementation. Copy here stays to the tagline already reviewed in
// lib/services.ts; it does not invent pricing, availability, ratings or
// capabilities per that handoff's §23 "Content governance."

export function ServiceComingSoon({ service }: { service: ServiceFamily }) {
  return (
    <div className="hero">
      <h1>{service.name}</h1>
      <p>{service.tagline}</p>
      <p className="muted">
        The full {service.name} page — use cases, process, trust content and a service-specific AI
        Concierge — is coming in a later build. In the meantime, tell the Concierge what you need
        and we&apos;ll route it to the right team.
      </p>
      <div className="actions-row" style={{ marginTop: '1.5rem' }}>
        <Link href="/register" className="btn">
          Start a request →
        </Link>
        <Link href="/" className="btn btn--secondary">
          Back to homepage
        </Link>
      </div>
    </div>
  );
}
