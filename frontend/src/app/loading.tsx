import { SkeletonCard } from '@/components/ui/Skeleton';

// Next.js app-router loading convention (route-level Suspense boundary).
// Design-system spec: Sprint 1 "loading skeleton ... primitives" — a
// route-specific loading.tsx can override this where a screen's shape
// differs meaningfully; this is the sensible default.

export default function Loading() {
  return (
    <div style={{ padding: '2.5rem 0', display: 'flex', flexDirection: 'column', gap: '1rem' }}>
      <SkeletonCard />
      <SkeletonCard />
    </div>
  );
}
