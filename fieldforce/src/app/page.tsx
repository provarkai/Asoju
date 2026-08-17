'use client';
import { Suspense, lazy } from 'react';

const PortalRouter = lazy(() => import('./portal-router'));

function Fallback() {
  return (
    <div className="min-h-screen bg-background flex items-center justify-center">
      <div className="flex flex-col items-center gap-4">
        <div className="w-12 h-12 border-4 border-primary border-t-transparent rounded-full animate-spin" />
        <p className="text-sm text-muted-foreground">Loading ASOJU Platform...</p>
      </div>
    </div>
  );
}

export default function Home() {
  return (
    <Suspense fallback={<Fallback />}>
      <PortalRouter />
    </Suspense>
  );
}
