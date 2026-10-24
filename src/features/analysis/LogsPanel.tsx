import { AlertTriangle, CheckCircle2, CircleAlert, Info, ScrollText } from 'lucide-react';
import { Button } from '@/components/ui/Button';
import { EmptyState } from '@/components/ui/Feedback';
import { useLogStore, type LogLevel } from '@/stores/logStore';

const ICONS: Record<LogLevel, React.ReactNode> = {
  info: <Info className="size-3.5 text-info" aria-label="info" />,
  success: <CheckCircle2 className="size-3.5 text-success" aria-label="success" />,
  warning: <AlertTriangle className="size-3.5 text-warning" aria-label="warning" />,
  error: <CircleAlert className="size-3.5 text-danger" aria-label="error" />,
};

export function LogsPanel() {
  const entries = useLogStore((s) => s.entries);
  if (entries.length === 0)
    return (
      <EmptyState title="No log entries" icon={<ScrollText />}>
        Computations, warnings and errors are recorded here with timestamps.
      </EmptyState>
    );
  return (
    <div className="p-4">
      <div className="mb-2 flex justify-end gap-2">
        <Button
          size="xs"
          variant="ghost"
          onClick={() =>
            void navigator.clipboard?.writeText(
              entries
                .map((e) => `${e.time} [${e.level}] ${e.message}${e.detail ? ` — ${e.detail}` : ''}`)
                .join('\n'),
            )
          }
        >
          Copy log
        </Button>
        <Button size="xs" variant="ghost" onClick={() => useLogStore.getState().clear()}>
          Clear
        </Button>
      </div>
      <ol className="space-y-1 font-mono text-xs" aria-live="polite">
        {[...entries].reverse().map((e) => (
          <li key={e.id} className="flex gap-2 rounded px-1 py-0.5 hover:bg-elevated/50">
            <span className="mt-0.5 shrink-0">{ICONS[e.level]}</span>
            <span className="shrink-0 text-subtle">{new Date(e.time).toLocaleTimeString()}</span>
            <span className="min-w-0 text-fg/90">
              {e.message}
              {e.detail && (
                <details className="text-subtle">
                  <summary className="cursor-pointer select-none">details</summary>
                  <pre className="mt-1 whitespace-pre-wrap break-all">{e.detail}</pre>
                </details>
              )}
            </span>
          </li>
        ))}
      </ol>
    </div>
  );
}
