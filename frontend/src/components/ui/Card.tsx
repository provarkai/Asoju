import { HTMLAttributes } from 'react';

// Design-system spec §8 "Card system" — BaseCard: "common surface,
// padding, border/elevation and responsive behavior." The service-
// specific cards it describes (ServiceCard, CaseCard, QuoteCard,
// ActivityCard, ProofCard, InfoCard) are content compositions on top of
// this — built where each is actually needed (Sprint 6/7/9), not as
// speculative empty shells here.

export interface CardProps extends HTMLAttributes<HTMLDivElement> {
  interactive?: boolean;
  padding?: 'compact' | 'default';
}

export function Card({ interactive = false, padding = 'default', className, style, ...rest }: CardProps) {
  return (
    <div
      className={['card', interactive ? 'card--interactive' : '', className].filter(Boolean).join(' ')}
      style={padding === 'compact' ? { padding: 'var(--space-4)', ...style } : style}
      {...rest}
    />
  );
}
