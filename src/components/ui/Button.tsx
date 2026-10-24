import { forwardRef, type ButtonHTMLAttributes, type ReactNode } from 'react';
import { Tooltip } from './Tooltip';
import { cn } from '@/utils/misc';

type Variant = 'primary' | 'secondary' | 'ghost' | 'danger' | 'outline';
type Size = 'xs' | 'sm' | 'md' | 'lg';

const variants: Record<Variant, string> = {
  primary:
    'bg-accent text-canvas font-semibold hover:bg-accent-strong shadow-[0_0_0_1px_rgb(124_140_255/0.4),0_8px_24px_-8px_rgb(124_140_255/0.55)]',
  secondary: 'bg-elevated text-fg border border-line hover:border-line-strong hover:bg-[#222b3e]',
  outline: 'border border-line text-fg hover:border-accent/60 hover:bg-accent/5',
  ghost: 'text-muted hover:text-fg hover:bg-elevated',
  danger: 'bg-danger/10 text-danger border border-danger/30 hover:bg-danger/20',
};

const sizes: Record<Size, string> = {
  xs: 'h-7 px-2 text-xs gap-1.5 rounded-md',
  sm: 'h-8 px-3 text-sm gap-1.5 rounded-lg',
  md: 'h-9 px-4 text-sm gap-2 rounded-lg',
  lg: 'h-11 px-6 text-[0.95rem] gap-2 rounded-xl',
};

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: Variant;
  size?: Size;
  icon?: ReactNode;
  loading?: boolean;
}

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(function Button(
  {
    variant = 'secondary',
    size = 'md',
    icon,
    loading,
    className,
    children,
    disabled,
    type = 'button',
    ...rest
  },
  ref,
) {
  return (
    <button
      ref={ref}
      type={type}
      disabled={disabled || loading}
      aria-busy={loading || undefined}
      className={cn(
        'inline-flex shrink-0 items-center justify-center whitespace-nowrap transition-colors duration-150 select-none',
        'disabled:pointer-events-none disabled:opacity-45',
        variants[variant],
        sizes[size],
        className,
      )}
      {...rest}
    >
      {loading ? (
        <span
          className="size-3.5 animate-spin rounded-full border-2 border-current border-t-transparent"
          aria-hidden
        />
      ) : (
        icon
      )}
      {children}
    </button>
  );
});

export interface IconButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  label: string;
  icon: ReactNode;
  active?: boolean;
  size?: 'sm' | 'md';
  tooltipSide?: 'top' | 'bottom' | 'left' | 'right';
  shortcut?: string;
}

export const IconButton = forwardRef<HTMLButtonElement, IconButtonProps>(function IconButton(
  { label, icon, active, size = 'md', className, tooltipSide = 'bottom', shortcut, type = 'button', ...rest },
  ref,
) {
  return (
    <Tooltip content={shortcut ? `${label} (${shortcut})` : label} side={tooltipSide}>
      <button
        ref={ref}
        type={type}
        aria-label={label}
        aria-pressed={active === undefined ? undefined : active}
        className={cn(
          'inline-flex shrink-0 items-center justify-center rounded-lg transition-colors duration-150',
          'disabled:pointer-events-none disabled:opacity-40',
          size === 'sm' ? 'size-7 [&_svg]:size-3.5' : 'size-8 [&_svg]:size-4',
          active
            ? 'bg-accent/15 text-accent ring-1 ring-accent/40'
            : 'text-muted hover:bg-elevated hover:text-fg',
          className,
        )}
        {...rest}
      >
        {icon}
      </button>
    </Tooltip>
  );
});
