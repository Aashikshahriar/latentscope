import { Eye, EyeOff, Filter } from 'lucide-react';
import { Button } from '@/components/ui/Button';
import { Callout } from '@/components/ui/Feedback';
import { Select, Switch } from '@/components/ui/Form';
import { Section } from '@/components/ui/Overlay';
import { EMPTY_CLUSTERINGS, useActiveDataset, useDatasetStore } from '@/stores/datasetStore';
import { useViewStore } from '@/stores/viewStore';
import { sequentialGradientCss } from '@/visualization/common/palettes';
import { formatNumber } from '@/utils/format';
import { useColorMapping } from '../useExplorerData';
import { decodeColorBy, encodeColorBy } from '@/visualization/common/colorMapping';

const ROLE_LABEL: Record<string, string> = {
  label: 'ground-truth label',
  cluster: 'imported cluster',
  'source-model': 'source model',
  modality: 'modality',
  custom: 'metadata',
  'sample-name': 'name',
  text: 'text',
  'image-url': 'image',
};

export function ColorFilterSection() {
  const dataset = useActiveDataset();
  const clusterings = useDatasetStore((s) =>
    dataset ? (s.clusterings[dataset.id] ?? EMPTY_CLUSTERINGS) : EMPTY_CLUSTERINGS,
  );
  const colorBy = useViewStore((s) => s.colorBy);
  const hidden = useViewStore((s) => s.hidden);
  const isolate = useViewStore((s) => s.isolateSelection);
  const selectionCount = useViewStore((s) => s.selection.length);
  const mapping = useColorMapping(dataset);

  if (!dataset) return null;
  const columnOptions = dataset.columns
    .filter((c) => c.role !== 'text' && c.role !== 'image-url')
    .map((c) => ({
      value: `col:${c.name}`,
      label: c.name,
      description: `${ROLE_LABEL[c.role] ?? c.role} · ${c.kind}`,
    }));
  const clusterOptions = clusterings.map((c, i) => ({
    value: `cl:${c.id}`,
    label: `Computed #${i + 1}: ${c.method} (${c.clusterCount} clusters)`,
    description: `computed in ${c.space} space — not a label`,
  }));

  return (
    <Section title="Colour & filter" icon={<Filter />}>
      <Select
        label="Colour by"
        value={encodeColorBy(colorBy)}
        onChange={(v) => useViewStore.getState().setColorBy(decodeColorBy(v))}
        options={[{ value: 'none', label: 'Uniform colour' }, ...columnOptions, ...clusterOptions]}
      />
      {mapping?.warnings.map((w) => (
        <Callout key={w} tone="warning">
          {w}
        </Callout>
      ))}
      {mapping?.mode === 'numeric' && mapping.numericRange && (
        <div>
          <div
            className="h-2.5 rounded-sm"
            style={{ background: sequentialGradientCss(useViewStore.getState().visuals.sequentialPalette) }}
          />
          <div className="num mt-1 flex justify-between text-2xs text-subtle">
            <span>{formatNumber(mapping.numericRange[0])}</span>
            <span>{formatNumber(mapping.numericRange[1])}</span>
          </div>
          {mapping.missingCount > 0 && (
            <p className="mt-1 text-2xs text-subtle">{mapping.missingCount} missing values shown in grey.</p>
          )}
        </div>
      )}
      {mapping?.mode === 'categorical' && (
        <div>
          <div className="mb-1.5 flex items-center justify-between">
            <span className="text-xs text-muted">{mapping.categories.length} categories</span>
            <div className="flex gap-1">
              <Button
                size="xs"
                variant="ghost"
                icon={<Eye className="size-3" />}
                onClick={() => useViewStore.getState().setHidden([])}
              >
                All
              </Button>
              <Button
                size="xs"
                variant="ghost"
                icon={<EyeOff className="size-3" />}
                onClick={() => useViewStore.getState().setHidden(mapping.categories.map((c) => c.key))}
              >
                None
              </Button>
            </div>
          </div>
          <ul className="scroll-thin max-h-56 space-y-0.5 overflow-y-auto pr-1" aria-label="Categories">
            {mapping.categories.map((c) => {
              const isHidden = hidden.includes(c.key);
              return (
                <li key={c.key}>
                  <button
                    type="button"
                    aria-pressed={!isHidden}
                    title="Click to show/hide · double-click to show only this category"
                    onClick={() => useViewStore.getState().toggleHidden(c.key)}
                    onDoubleClick={() =>
                      useViewStore
                        .getState()
                        .setHidden(mapping.categories.filter((o) => o.key !== c.key).map((o) => o.key))
                    }
                    className="flex w-full items-center gap-2 rounded-md px-1.5 py-1 text-left text-xs hover:bg-elevated"
                  >
                    <span
                      className="size-2.5 shrink-0 rounded-full"
                      style={{ background: c.color, opacity: isHidden ? 0.25 : 1 }}
                    />
                    <span className={isHidden ? 'truncate text-subtle line-through' : 'truncate text-fg/90'}>
                      {c.label}
                    </span>
                    <span className="num ml-auto text-2xs text-subtle">{c.count}</span>
                  </button>
                </li>
              );
            })}
          </ul>
        </div>
      )}
      <Switch
        label="Show only selected points"
        checked={isolate}
        disabled={selectionCount === 0}
        onChange={(v) => useViewStore.getState().setIsolate(v)}
        hint="Hides every observation outside the current selection, in all synchronised views."
      />
    </Section>
  );
}
