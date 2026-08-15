import { LucideIcon } from 'lucide-react';
import { ReactNode } from 'react';
import { cn } from '@/lib/utils';
import { statusDot, statusLabel, statusTone } from '@/lib/statusMeta';

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
