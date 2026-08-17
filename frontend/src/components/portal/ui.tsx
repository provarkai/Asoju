import { AlertTriangle, LucideIcon } from 'lucide-react';
import { ReactNode } from 'react';
import { cn } from '@/lib/utils';
import { statusDot, statusLabel, statusTone } from '@/lib/statusMeta';
import { Button } from '@/components/ui/button';

export function StatusPill({ status, className }: { status: string; className?: string }) {
  return (
    <span
      className={cn(
        'inline-flex items-center gap-1.5 rounded-full border px-2.5 py-0.5 text-[11px] font-semibold',
        statusTone(status),
        className,
      )}
    >
      <span className={cn('size-1.5 rounded-full', statusDot(status))} />
      {statusLabel(status)}
    </span>
  );
}

export function StatCard({
  icon: Icon,
  label,
  value,
  hint,
  accent,
}: {
  icon: LucideIcon;
  label: string;
  value: string | number;
  hint?: string;
  accent?: string;
}) {
  return (
    <div className="rounded-2xl border border-forest/10 bg-white p-5 shadow-sm transition-shadow hover:shadow-md">
      <div className="flex items-center justify-between">
        <span className={cn('flex size-10 items-center justify-center rounded-xl', accent ?? 'bg-forest/8 text-forest')}>
          <Icon className="size-5" />
        </span>
      </div>
      <p className="mt-4 font-display text-3xl font-semibold text-forest">{value}</p>
      <p className="mt-0.5 text-sm font-medium text-forest/70">{label}</p>
      {hint && <p className="mt-0.5 text-xs text-forest/45">{hint}</p>}
    </div>
  );
}

export function SectionTitle({ title, action }: { title: string; action?: ReactNode }) {
  return (
    <div className="mb-4 flex items-center justify-between">
      <h2 className="font-display text-xl font-semibold text-forest">{title}</h2>
      {action}
    </div>
  );
}

/**
 * The customer portal's one real, systemic navigation gap: every page's
 * failed-fetch state used to be bare `<p className="error-text">` — a
 * dead end with no way forward except a manual browser refresh. That
 * matters here specifically because the backend sleeps after 15 minutes
 * idle (README) and takes a few seconds to wake, so a customer landing
 * mid-cold-start could hit this. Same visual language as EmptyState
 * (which it deliberately mirrors) but a solid warm-red border instead of
 * a dashed neutral one, and the action is always "try again," not a
 * feature CTA. onRetry is expected to be the same load function the
 * page already calls on mount.
 */
export function ErrorState({ message, onRetry }: { message: string; onRetry: () => void }) {
  return (
    <div className="flex flex-col items-center rounded-2xl border border-red-200 bg-red-50/60 px-6 py-14 text-center">
      <span className="flex size-14 items-center justify-center rounded-2xl bg-red-100 text-red-600">
        <AlertTriangle className="size-7" />
      </span>
      <h3 className="mt-5 font-display text-xl font-semibold text-forest">Something went wrong</h3>
      <p className="mt-2 max-w-sm text-sm text-forest/60">{message}</p>
      <div className="mt-6">
        <Button variant="outline" className="border-red-200 text-red-700 hover:bg-red-50" onClick={onRetry}>
          Try again
        </Button>
      </div>
    </div>
  );
}

export function EmptyState({
  icon: Icon,
  title,
  copy,
  action,
}: {
  icon: LucideIcon;
  title: string;
  copy: string;
  action?: ReactNode;
}) {
  return (
    <div className="flex flex-col items-center rounded-2xl border border-dashed border-forest/20 bg-white/60 px-6 py-14 text-center">
      <span className="flex size-14 items-center justify-center rounded-2xl bg-forest/8 text-forest">
        <Icon className="size-7" />
      </span>
      <h3 className="mt-5 font-display text-xl font-semibold text-forest">{title}</h3>
      <p className="mt-2 max-w-sm text-sm text-forest/60">{copy}</p>
      {action && <div className="mt-6">{action}</div>}
    </div>
  );
}
