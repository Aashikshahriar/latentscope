import { useMemo, useRef, useState } from 'react';
import { TextInput } from '@/components/ui/Form';
import type { Dataset } from '@/types/dataset';
import { useViewStore } from '@/stores/viewStore';
import { formatNumber } from '@/utils/format';
import { coordsOfRow, useColorMapping, useDisplayedProjection } from '../explorer/useExplorerData';

const ROW_HEIGHT = 28;

/**
 * Tabular, keyboard-accessible alternative to the visualization: every observation with its
 * identifier, category and projected coordinates. ↑/↓ move, Enter inspects, Space toggles selection.
 */
export function DataTable({ dataset }: { dataset: Dataset }) {
  const projection = useDisplayedProjection(dataset);
  const mapping = useColorMapping(dataset);
  const selection = useViewStore((s) => s.selection);
  const focus = useViewStore((s) => s.focus);
  const [query, setQuery] = useState('');
  const [onlySelected, setOnlySelected] = useState(false);
  const [scrollTop, setScrollTop] = useState(0);
  const [cursor, setCursor] = useState(0);
  const containerRef = useRef<HTMLDivElement>(null);
  const selectedSet = useMemo(() => new Set(selection), [selection]);

  const rows = useMemo(() => {
    const q = query.trim().toLowerCase();
    const out: number[] = [];
    for (let i = 0; i < dataset.n; i++) {
      if (onlySelected && !selectedSet.has(i)) continue;
      if (q) {
        const cat =
          mapping?.mode === 'categorical' ? (mapping.categories[mapping.categoryIndex[i]!]?.label ?? '') : '';
        if (!dataset.ids[i]!.toLowerCase().includes(q) && !cat.toLowerCase().includes(q)) continue;
      }
      out.push(i);
    }
    return out;
  }, [dataset, query, onlySelected, selectedSet, mapping]);

  const height = 200;
  const start = Math.max(0, Math.floor(scrollTop / ROW_HEIGHT) - 5);
  const end = Math.min(rows.length, start + Math.ceil(height / ROW_HEIGHT) + 10);
  const dims = projection?.dims ?? 0;

  const moveCursor = (next: number) => {
    const c = Math.max(0, Math.min(rows.length - 1, next));
    setCursor(c);
    const el = containerRef.current;
    if (el) {
      if (c * ROW_HEIGHT < el.scrollTop) el.scrollTop = c * ROW_HEIGHT;
      else if ((c + 1) * ROW_HEIGHT > el.scrollTop + el.clientHeight - ROW_HEIGHT)
        el.scrollTop = (c + 2) * ROW_HEIGHT - el.clientHeight;
    }
    const row = rows[c];
    if (row !== undefined) useViewStore.getState().setHover(row);
  };

  return (
    <div className="space-y-2 p-4">
      <div className="flex flex-wrap items-center gap-3">
        <TextInput
          className="max-w-64"
          placeholder="Search by id or category…"
          aria-label="Search observations"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
        />
        <label className="flex items-center gap-1.5 text-xs text-muted">
          <input
            type="checkbox"
            checked={onlySelected}
            onChange={(e) => setOnlySelected(e.target.checked)}
            className="accent-[var(--color-accent)]"
          />
          Selected only
        </label>
        <span className="num text-xs text-subtle">{rows.length.toLocaleString()} rows</span>
      </div>
      <div
        ref={containerRef}
        role="grid"
        aria-label={`Observations of ${dataset.name}`}
        aria-rowcount={rows.length + 1}
        tabIndex={0}
        className="scroll-thin relative overflow-auto rounded-lg border border-line focus-visible:shadow-[var(--focus-ring)]"
        style={{ height }}
        onScroll={(e) => setScrollTop(e.currentTarget.scrollTop)}
        onKeyDown={(e) => {
          const row = rows[cursor];
          if (e.key === 'ArrowDown') moveCursor(cursor + 1);
          else if (e.key === 'ArrowUp') moveCursor(cursor - 1);
          else if (e.key === 'PageDown') moveCursor(cursor + 6);
          else if (e.key === 'PageUp') moveCursor(cursor - 6);
          else if (e.key === 'Enter' && row !== undefined) useViewStore.getState().setFocus(row);
          else if (e.key === ' ' && row !== undefined)
            useViewStore.getState().setSelection([row], selectedSet.has(row) ? 'subtract' : 'add');
          else return;
          e.preventDefault();
        }}
      >
        <div
          role="row"
          className="sticky top-0 z-10 grid grid-cols-[2rem_minmax(8rem,1.5fr)_minmax(6rem,1fr)_minmax(10rem,1.5fr)] gap-2 border-b border-line bg-surface px-2 text-2xs font-medium text-subtle uppercase"
          style={{ height: ROW_HEIGHT, lineHeight: `${ROW_HEIGHT}px` }}
        >
          <span role="columnheader" aria-label="Selected" />
          <span role="columnheader">Identifier</span>
          <span role="columnheader">{mapping?.mode === 'categorical' ? mapping.title : 'Category'}</span>
          <span role="columnheader">Coordinates</span>
        </div>
        <div style={{ height: rows.length * ROW_HEIGHT, position: 'relative' }}>
          {rows.slice(start, end).map((row, offset) => {
            const index = start + offset;
            const coords = projection ? coordsOfRow(projection, row) : null;
            const cat =
              mapping?.mode === 'categorical' ? mapping.categories[mapping.categoryIndex[row]!] : null;
            return (
              <div
                key={row}
                role="row"
                aria-rowindex={index + 2}
                aria-selected={selectedSet.has(row)}
                onClick={() => {
                  setCursor(index);
                  useViewStore.getState().setFocus(row);
                }}
                className={`absolute inset-x-0 grid cursor-pointer grid-cols-[2rem_minmax(8rem,1.5fr)_minmax(6rem,1fr)_minmax(10rem,1.5fr)] items-center gap-2 px-2 text-xs hover:bg-elevated ${index === cursor ? 'ring-1 ring-accent/50 ring-inset' : ''} ${row === focus ? 'bg-accent/10' : ''}`}
                style={{ top: index * ROW_HEIGHT, height: ROW_HEIGHT }}
              >
                <span role="gridcell">
                  <input
                    type="checkbox"
                    tabIndex={-1}
                    aria-label={`Select ${dataset.ids[row]}`}
                    checked={selectedSet.has(row)}
                    onClick={(e) => e.stopPropagation()}
                    onChange={(e) =>
                      useViewStore.getState().setSelection([row], e.target.checked ? 'add' : 'subtract')
                    }
                    className="accent-[var(--color-accent)]"
                  />
                </span>
                <span role="gridcell" className="num truncate text-fg/90">
                  {dataset.ids[row]}
                </span>
                <span role="gridcell" className="flex min-w-0 items-center gap-1.5">
                  {cat && <span className="size-2 shrink-0 rounded-full" style={{ background: cat.color }} />}
                  <span className="truncate text-muted">{cat?.label ?? '—'}</span>
                </span>
                <span role="gridcell" className="num truncate text-muted">
                  {coords
                    ? coords.map((c) => formatNumber(c, 3)).join(', ')
                    : dims
                      ? 'not in subsample'
                      : '—'}
                </span>
              </div>
            );
          })}
        </div>
      </div>
      <p className="text-2xs text-subtle">
        Keyboard: focus the table, then ↑ ↓ to move, Enter to inspect, Space to toggle selection.
      </p>
    </div>
  );
}
