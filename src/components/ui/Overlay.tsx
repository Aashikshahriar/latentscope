import { Collapsible, Dialog as RadixDialog, Tabs as RadixTabs } from 'radix-ui';
import { ChevronRight, X } from 'lucide-react';
import { useState, type ReactNode } from 'react';
import { cn } from '@/utils/misc';

export function Dialog({
  open,
  onOpenChange,
  title,
  description,
  children,
  footer,
  size = 'md',
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: ReactNode;
  description?: ReactNode;
  children: ReactNode;
  footer?: ReactNode;
  size?: 'sm' | 'md' | 'lg' | 'xl';
}) {
  const widths = { sm: 'max-w-md', md: 'max-w-xl', lg: 'max-w-3xl', xl: 'max-w-5xl' };
  return (
    <RadixDialog.Root open={open} onOpenChange={onOpenChange}>
      <RadixDialog.Portal>
        <RadixDialog.Overlay className="fixed inset-0 z-40 bg-black/60 backdrop-blur-[2px] animate-fade-in" />
        <RadixDialog.Content
          className={cn(
            'fixed top-1/2 left-1/2 z-50 flex max-h-[min(92vh,900px)] w-[calc(100vw-1.5rem)] -translate-x-1/2 -translate-y-1/2 flex-col overflow-hidden rounded-2xl border border-line bg-card shadow-pop animate-fade-in',
            widths[size],
          )}
        >
          <div className="flex items-start justify-between gap-4 border-b border-line px-5 py-4">
            <div className="min-w-0">
              <RadixDialog.Title className="text-base font-semibold text-fg">{title}</RadixDialog.Title>
              {description ? (
                <RadixDialog.Description className="mt-1 text-xs leading-relaxed text-muted">
                  {description}
                </RadixDialog.Description>
              ) : (
                <RadixDialog.Description className="sr-only">
                  {typeof title === 'string' ? title : 'Dialog'}
                </RadixDialog.Description>
              )}
            </div>
            <RadixDialog.Close
              className="rounded-md p-1 text-muted hover:bg-elevated hover:text-fg"
              aria-label="Close"
            >
              <X className="size-4" />
            </RadixDialog.Close>
          </div>
          <div className="scroll-thin min-h-0 flex-1 overflow-y-auto px-5 py-4">{children}</div>
          {footer && (
            <div className="flex flex-wrap items-center justify-end gap-2 border-t border-line bg-surface/60 px-5 py-3">
              {footer}
            </div>
          )}
        </RadixDialog.Content>
      </RadixDialog.Portal>
    </RadixDialog.Root>
  );
}

export interface TabItem<T extends string> {
  value: T;
  label: ReactNode;
  content: ReactNode;
  disabled?: boolean;
}

export function Tabs<T extends string>({
  value,
  onChange,
  items,
  ariaLabel,
  className,
  listClassName,
  contentClassName,
  actions,
}: {
  value: T;
  onChange: (v: T) => void;
  items: TabItem<T>[];
  ariaLabel: string;
  className?: string;
  listClassName?: string;
  contentClassName?: string;
  actions?: ReactNode;
}) {
  return (
    <RadixTabs.Root
      value={value}
      onValueChange={(v) => onChange(v as T)}
      className={cn('flex min-h-0 flex-col', className)}
    >
      <div className={cn('flex items-center gap-2 border-b border-line', listClassName)}>
        <RadixTabs.List
          aria-label={ariaLabel}
          className="scroll-thin flex min-w-0 flex-1 gap-1 overflow-x-auto"
        >
          {items.map((item) => (
            <RadixTabs.Trigger
              key={item.value}
              value={item.value}
              disabled={item.disabled}
              className="relative flex h-9 shrink-0 items-center gap-1.5 px-2.5 text-xs font-medium text-muted transition-colors hover:text-fg disabled:opacity-40 data-[state=active]:text-fg data-[state=active]:after:absolute data-[state=active]:after:inset-x-2 data-[state=active]:after:-bottom-px data-[state=active]:after:h-0.5 data-[state=active]:after:rounded-full data-[state=active]:after:bg-accent [&_svg]:size-3.5"
            >
              {item.label}
            </RadixTabs.Trigger>
          ))}
        </RadixTabs.List>
        {actions}
      </div>
      {items.map((item) => (
        <RadixTabs.Content
          key={item.value}
          value={item.value}
          className={cn('min-h-0 flex-1 focus-visible:shadow-none', contentClassName)}
        >
          {item.content}
        </RadixTabs.Content>
      ))}
    </RadixTabs.Root>
  );
}

/** Collapsible sidebar section with a heading button. */
export function Section({
  title,
  icon,
  children,
  defaultOpen = true,
  aside,
}: {
  title: string;
  icon?: ReactNode;
  children: ReactNode;
  defaultOpen?: boolean;
  aside?: ReactNode;
}) {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <Collapsible.Root open={open} onOpenChange={setOpen} className="border-b border-line/70 last:border-b-0">
      <div className="flex items-center">
        <Collapsible.Trigger className="group flex flex-1 items-center gap-2 px-4 py-3 text-left text-xs font-semibold tracking-wide text-fg/90 uppercase hover:text-fg">
          <ChevronRight
            className="size-3.5 text-subtle transition-transform group-data-[state=open]:rotate-90"
            aria-hidden
          />
          {icon && <span className="text-subtle [&_svg]:size-3.5">{icon}</span>}
          {title}
        </Collapsible.Trigger>
        {aside && <div className="pr-3">{aside}</div>}
      </div>
      <Collapsible.Content className="space-y-3.5 px-4 pb-4">{children}</Collapsible.Content>
    </Collapsible.Root>
  );
}

export function Card({
  children,
  className,
  title,
  actions,
}: {
  children: ReactNode;
  className?: string;
  title?: ReactNode;
  actions?: ReactNode;
}) {
  return (
    <section
      className={cn('rounded-[var(--radius-card)] border border-line bg-card shadow-panel', className)}
    >
      {(title || actions) && (
        <header className="flex items-center justify-between gap-3 border-b border-line px-4 py-3">
          {title && <h3 className="text-sm font-semibold text-fg">{title}</h3>}
          {actions}
        </header>
      )}
      {children}
    </section>
  );
}
