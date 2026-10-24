import { cn } from '@/utils/misc';

export function LogoMark({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 64 64" fill="none" className={cn('size-7', className)} aria-hidden>
      <rect width="64" height="64" rx="14" fill="#101521" />
      <circle cx="32" cy="32" r="21" stroke="#273246" strokeWidth="2" />
      <ellipse
        cx="32"
        cy="32"
        rx="21"
        ry="8"
        stroke="#7C8CFF"
        strokeWidth="2"
        transform="rotate(-28 32 32)"
      />
      <circle cx="22" cy="27" r="3.5" fill="#7C8CFF" />
      <circle cx="40" cy="22" r="3" fill="#38D9C5" />
      <circle cx="38" cy="40" r="3.5" fill="#C084FC" />
      <circle cx="27" cy="41" r="2.2" fill="#38D9C5" />
      <circle cx="44" cy="31" r="2" fill="#7C8CFF" />
    </svg>
  );
}

export function Logo({ className }: { className?: string }) {
  return (
    <span className={cn('inline-flex items-center gap-2.5', className)}>
      <LogoMark />
      <span className="text-[0.95rem] font-semibold tracking-tight text-fg">
        Latent<span className="text-accent">Scope</span>
      </span>
    </span>
  );
}
