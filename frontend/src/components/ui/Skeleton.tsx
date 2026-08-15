// Design-system spec: Sprint 1 "Add loading skeleton and error-boundary
// primitives." Every data-dependent screen in the route inventory (§15
// "Screen-state checklist") needs an explicit Loading state — this is
// the shared shape for it, instead of six pages hand-rolling gray boxes.
// Shimmer animation respects prefers-reduced-motion via the global rule
// in globals.css.

export function Skeleton({
  width = '100%',
  height = '1rem',
  circle = false,
  style,
}: {
  width?: string | number;
  height?: string | number;
  circle?: boolean;
  style?: React.CSSProperties;
}) {
  return (
    <span
      className="skeleton"
      aria-hidden="true"
      style={{ width, height, borderRadius: circle ? '50%' : 'var(--radius)', ...style }}
    />
  );
}

export function SkeletonText({ lines = 3 }: { lines?: number }) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-2)' }} aria-hidden="true">
      {Array.from({ length: lines }).map((_, i) => (
        <Skeleton key={i} height="0.85rem" width={i === lines - 1 ? '60%' : '100%'} />
      ))}
    </div>
  );
}

export function SkeletonCard() {
  return (
    <div className="card" aria-hidden="true">
      <Skeleton height="1.1rem" width="40%" style={{ marginBottom: 'var(--space-3)' }} />
      <SkeletonText lines={2} />
    </div>
  );
}
