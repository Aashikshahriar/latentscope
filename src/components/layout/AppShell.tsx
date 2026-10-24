import { Dialog as RadixDialog } from 'radix-ui';
import { Code2, Menu, ShieldCheck, X } from 'lucide-react';
import { useState } from 'react';
import { NavLink, Outlet, Link } from 'react-router';
import { Logo } from '@/components/common/Logo';
import { Tooltip } from '@/components/ui/Tooltip';
import { REPOSITORY_URL } from '@/config';
import { cn } from '@/utils/misc';
import { NAV_ITEMS } from './navigation';

function navClass({ isActive }: { isActive: boolean }) {
  return cn(
    'rounded-md px-2.5 py-1.5 text-[0.8rem] font-medium transition-colors whitespace-nowrap',
    isActive ? 'bg-elevated text-fg' : 'text-muted hover:text-fg',
  );
}

export function TopNav() {
  const [open, setOpen] = useState(false);
  return (
    <header className="relative z-30 flex h-12 shrink-0 items-center gap-4 border-b border-line bg-canvas/90 px-3 backdrop-blur sm:px-4">
      <Link to="/" className="shrink-0 rounded-md" aria-label="LatentScope home">
        <Logo />
      </Link>
      <nav aria-label="Primary" className="hidden min-w-0 items-center gap-0.5 lg:flex">
        {NAV_ITEMS.map((item) => (
          <NavLink key={item.to} to={item.to} className={navClass}>
            {item.label}
          </NavLink>
        ))}
      </nav>
      <div className="ml-auto flex items-center gap-2">
        <Tooltip content="All data is processed locally in your browser. Nothing is uploaded.">
          <span
            className="hidden items-center gap-1.5 rounded-full border border-teal/25 bg-teal/[0.07] px-2.5 py-1 text-2xs font-medium text-teal sm:inline-flex"
            tabIndex={0}
          >
            <ShieldCheck className="size-3.5" aria-hidden /> Local-only processing
          </span>
        </Tooltip>
        {REPOSITORY_URL && (
          <a
            href={REPOSITORY_URL}
            target="_blank"
            rel="noreferrer"
            className="hidden size-8 items-center justify-center rounded-lg text-muted hover:bg-elevated hover:text-fg sm:inline-flex"
            aria-label="Source code repository"
          >
            <Code2 className="size-4" />
          </a>
        )}
        <RadixDialog.Root open={open} onOpenChange={setOpen}>
          <RadixDialog.Trigger
            className="inline-flex size-8 items-center justify-center rounded-lg text-muted hover:bg-elevated hover:text-fg lg:hidden"
            aria-label="Open navigation menu"
          >
            <Menu className="size-4.5" />
          </RadixDialog.Trigger>
          <RadixDialog.Portal>
            <RadixDialog.Overlay className="fixed inset-0 z-40 bg-black/60" />
            <RadixDialog.Content className="fixed inset-y-0 right-0 z-50 flex w-72 max-w-[85vw] flex-col border-l border-line bg-card p-4 shadow-pop animate-fade-in">
              <div className="mb-4 flex items-center justify-between">
                <RadixDialog.Title className="text-sm font-semibold">Navigation</RadixDialog.Title>
                <RadixDialog.Description className="sr-only">
                  Main sections of LatentScope
                </RadixDialog.Description>
                <RadixDialog.Close
                  className="rounded-md p-1 text-muted hover:text-fg"
                  aria-label="Close menu"
                >
                  <X className="size-4" />
                </RadixDialog.Close>
              </div>
              <nav aria-label="Primary mobile" className="flex flex-col gap-1">
                <NavLink to="/" end className={navClass} onClick={() => setOpen(false)}>
                  Home
                </NavLink>
                {NAV_ITEMS.map((item) => (
                  <NavLink key={item.to} to={item.to} className={navClass} onClick={() => setOpen(false)}>
                    {item.label}
                  </NavLink>
                ))}
              </nav>
              <p className="mt-auto flex items-center gap-1.5 text-2xs text-teal">
                <ShieldCheck className="size-3.5" aria-hidden /> All processing happens locally.
              </p>
            </RadixDialog.Content>
          </RadixDialog.Portal>
        </RadixDialog.Root>
      </div>
    </header>
  );
}

export function AppShell() {
  return (
    <div className="flex h-dvh flex-col overflow-hidden bg-canvas">
      <a
        href="#main"
        className="sr-only z-50 rounded bg-accent px-3 py-2 text-canvas focus:not-sr-only focus:absolute focus:top-2 focus:left-2"
      >
        Skip to content
      </a>
      <TopNav />
      <main id="main" className="relative min-h-0 flex-1">
        <Outlet />
      </main>
    </div>
  );
}
