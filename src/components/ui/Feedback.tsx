import { AlertTriangle, CheckCircle2, CircleAlert, Info } from 'lucide-react';
import type { ReactNode } from 'react';
import { cn } from '@/utils/misc';

type Tone = 'info' | 'warning' | 'danger' | 'success' | 'neutral';

const tones: Record<Tone, { box: string; icon: ReactNode }> = {
  info: {
    box: 'border-info/25 bg-info/[0.07] text-[#bcd7fb]',
    icon: <Info className="size-4 text-info" aria-hidden />,
  },
  warning: {
    box: 'border-warning/25 bg-warning/[0.07] text-[#f8e2a8]',
    icon: <AlertTriangle className="size-4 text-warning" aria-hidden />,
  },
  danger: {
    box: 'border-danger/30 bg-danger/[0.08] text-[#fbc9c9]',
    icon: <CircleAlert className="size-4 text-danger" aria-hidden />,
  },
  success: {
    box: 'border-success/25 bg-success/[0.07] text-[#b6efd8]',
    icon: <CheckCircle2 className="size-4 text-success" aria-hidden />,
  },
  neutral: {
    box: 'border-line bg-surface text-muted',
    icon: <Info className="size-4 text-subtle" aria-hidden />,
  },
};

export function Callout({
  tone = 'info',
  title,
  children,
  className,
  role,
}: {
  tone?: Tone;
  title?: ReactNode;
  children?: ReactNode;
  className?: string;
  role?: 'alert' | 'status';
}) {
  const t = tones[tone];
  return (
    <div
      role={role ?? (tone === 'danger' ? 'alert' : undefined)}
      className={cn('flex gap-2.5 rounded-lg border px-3 py-2.5 text-xs leading-relaxed', t.box, className)}
    >
      <span className="mt-px shrink-0">{t.icon}</span>
      <div className="min-w-0 space-y-1">
        {title && <p className="font-semibold text-fg">{title}</p>}
        {children && <div>{children}</div>}
      </div>
    </div>
  );
}

export function Badge({
  children,
  tone = 'neutral',
  className,
}: {
  children: ReactNode;
  tone?: Tone | 'accent' | 'teal' | 'violet';
  className?: string;
}) {
  const map: Record<string, string> = {
    neutral: 'border-line bg-surface text-muted',
    info: 'border-info/30 bg-info/10 text-info',
    warning: 'border-warning/30 bg-warning/10 text-warning',
    danger: 'border-danger/30 bg-danger/10 text-danger',
    success: 'border-success/30 bg-success/10 text-success',
    accent: 'border-accent/30 bg-accent/10 text-accent',
    teal: 'border-teal/30 bg-teal/10 text-teal',
    violet: 'border-violet/30 bg-violet/10 text-violet',
  };
  return (
    <span
      className={cn(
        'inline-flex items-center gap-1 rounded-md border px-1.5 py-px text-2xs font-medium whitespace-nowrap',
        map[tone],
        className,
      )}
    >
      {children}
    </span>
  );
}

export function ProgressBar({
  value,
  label,
  className,
}: {
  value: number | null;
  label: string;
  className?: string;
}) {
  const indeterminate = value === null || !Number.isFinite(value);
  return (
    <div
      role="progressbar"
      aria-label={label}
      aria-valuemin={0}
      aria-valuemax={100}
      aria-valuenow={indeterminate ? undefined : Math.round(value * 100)}
      aria-valuetext={indeterminate ? 'In progress' : `${Math.round(value * 100)}%`}
      className={cn('relative h-1.5 w-full overflow-hidden rounded-full bg-line', className)}
    >
      {indeterminate ? (
        <div className="absolute inset-y-0 w-2/5 animate-indeterminate rounded-full bg-gradient-to-r from-accent/0 via-accent to-accent/0" />
      ) : (
        <div
          className="h-full rounded-full bg-gradient-to-r from-accent to-teal transition-[width] duration-200"
          style={{ width: `${Math.max(1, value * 100)}%` }}
        />
      )}
    </div>
  );
}

export function Spinner({ className, label = 'Loading' }: { className?: string; label?: string }) {
  return (
    <span
      role="status"
      aria-label={label}
      className={cn(
        'inline-block size-4 animate-spin rounded-full border-2 border-accent/30 border-t-accent',
        className,
      )}
    />
  );
}

export function EmptyState({
  icon,
  title,
  children,
  action,
}: {
  icon?: ReactNode;
  title: ReactNode;
  children?: ReactNode;
  action?: ReactNode;
}) {
  return (
    <div className="flex flex-col items-center justify-center px-6 py-10 text-center">
      {icon && (
        <div className="mb-3 grid size-11 place-items-center rounded-xl border border-line bg-surface text-muted [&_svg]:size-5">
          {icon}
        </div>
      )}
      <p className="text-sm font-semibold text-fg">{title}</p>
      {children && <div className="mt-1.5 max-w-sm text-xs leading-relaxed text-muted">{children}</div>}
      {action && <div className="mt-4">{action}</div>}
    </div>
  );
}

export function Kbd({ children }: { children: ReactNode }) {
  return (
    <kbd className="num rounded border border-line bg-surface px-1 py-px text-2xs text-muted">{children}</kbd>
  );
}

export function Stat({
  label,
  value,
  hint,
  className,
}: {
  label: ReactNode;
  value: ReactNode;
  hint?: ReactNode;
  className?: string;
}) {
  return (
    <div className={cn('min-w-0 rounded-lg border border-line bg-surface px-3 py-2', className)}>
      <div className="truncate text-2xs font-medium tracking-wide text-subtle uppercase">{label}</div>
      <div className="num mt-0.5 truncate text-sm font-semibold text-fg">{value}</div>
      {hint && <div className="mt-0.5 truncate text-2xs text-subtle">{hint}</div>}
    </div>
  );
}
