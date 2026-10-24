import { BarChart3, Crosshair, Gauge, ListPlus, MousePointerClick, Sigma } from 'lucide-react';
import { useMemo, useState } from 'react';
import { Button } from '@/components/ui/Button';
import { Badge, EmptyState, Stat } from '@/components/ui/Feedback';
import { Section } from '@/components/ui/Overlay';
import { HorizontalBars } from '@/components/charts/Charts';
import type { Dataset } from '@/types/dataset';
import type { Experiment } from '@/types/experiment';
import { useConfigStore } from '@/stores/configStore';
import { useUiStore } from '@/stores/uiStore';
import { useViewStore } from '@/stores/viewStore';
import { formatInteger, formatNumber, formatPercent } from '@/utils/format';
import { coordsOfRow, useColorMapping, useDisplayedProjection } from '../explorer/useExplorerData';
import { featureGeometry, featureNeighbors, projectionNeighbors, type Neighbor } from './neighbors';
import { PixelPreview, UrlImagePreview } from './Previews';
import { pixelGrid } from './pixels';
import { MISSING_KEY } from '@/visualization/common/colorMapping';

const K_NEIGHBORS = 10;

export function InspectorPanel({ dataset }: { dataset: Dataset | null }) {
  const focus = useViewStore((s) => s.focus);
  const selection = useViewStore((s) => s.selection);
  const projection = useDisplayedProjection(dataset);
  if (!dataset)
    return (
      <EmptyState title="Nothing to inspect" icon={<MousePointerClick />}>
        Load a dataset to see its statistics here.
      </EmptyState>
    );
  return (
    <div className="scroll-thin h-full overflow-y-auto">
      <Section title="Observation" icon={<Crosshair />}>
        {focus === null ? (
          <p className="text-xs leading-relaxed text-subtle">
            Click a point in the visualization (or a row in the data table) to inspect it. Shift-click adds
            points to the selection.
          </p>
        ) : (
          <ObservationDetails
            dataset={dataset}
            row={focus}
            experiment={projection?.experiment ?? null}
            projection={projection}
          />
        )}
      </Section>
      {selection.length > 0 && <SelectionSummary dataset={dataset} rows={selection} />}
      <ClusterStatistics dataset={dataset} projection={projection} />
      <DatasetStatistics dataset={dataset} />
      {projection?.experiment && <MetricsGlance experiment={projection.experiment} />}
    </div>
  );
}

function ObservationDetails({
  dataset,
  row,
  experiment,
  projection,
}: {
  dataset: Dataset;
  row: number;
  experiment: Experiment | null;
  projection: ReturnType<typeof useDisplayedProjection>;
}) {
  const [showAllFeatures, setShowAllFeatures] = useState(false);
  const configPre = useConfigStore((s) => s.preprocessing);
  const preprocessing = experiment?.preprocessing ?? configPre;
  const metric = experiment?.params.algorithm === 'umap' ? experiment.params.metric : 'euclidean';
  const geometry = useMemo(() => featureGeometry(dataset, preprocessing), [dataset, preprocessing]);
  const candidateRows = projection?.rowIndices ?? null;
  const original = useMemo(
    () => featureNeighbors(dataset, geometry, row, K_NEIGHBORS, metric, candidateRows),
    [dataset, geometry, row, metric, candidateRows],
  );
  const projected = useMemo(
    () =>
      projection
        ? projectionNeighbors(projection.coords, projection.dims, projection.rowIndices, row, K_NEIGHBORS)
        : [],
    [projection, row],
  );
  const overlap = useMemo(() => {
    if (projected.length === 0) return null;
    const set = new Set(original.map((n) => n.row));
    return projected.filter((n) => set.has(n.row)).length / Math.min(original.length, projected.length);
  }, [original, projected]);

  const coords = projection ? coordsOfRow(projection, row) : null;
  const label = dataset.columns.find((c) => c.role === 'label');
  const image = dataset.columns.find((c) => c.role === 'image-url');
  const text = dataset.columns.find((c) => c.role === 'text');
  const side = pixelGrid(dataset);
  const features = Array.from(dataset.values.subarray(row * dataset.d, (row + 1) * dataset.d));
  const shownFeatures = showAllFeatures ? features : features.slice(0, 12);
  const view = useViewStore.getState();

  return (
    <div className="space-y-3.5">
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <p className="text-2xs font-medium tracking-wide text-subtle uppercase">Observation</p>
          <p className="num truncate text-sm font-semibold text-fg" title={dataset.ids[row]}>
            {dataset.ids[row]}
          </p>
          {label && label.values[row] !== null && (
            <Badge tone="accent" className="mt-1">
              {label.name}: {String(label.values[row])}
            </Badge>
          )}
        </div>
        <span className="num text-2xs text-subtle">row {formatInteger(row + 1)}</span>
      </div>

      {side && <PixelPreview dataset={dataset} row={row} side={side} />}
      {image && typeof image.values[row] === 'string' && (
        <UrlImagePreview url={image.values[row] as string} />
      )}
      {text && text.values[row] !== null && (
        <blockquote className="border-l-2 border-accent/50 pl-3 text-xs leading-relaxed text-fg/90 italic">
          {String(text.values[row])}
        </blockquote>
      )}

      <div>
        <p className="mb-1 text-xs font-medium text-muted">Projection coordinates</p>
        {coords ? (
          <div className="num flex flex-wrap gap-1.5 text-xs">
            {coords.map((c, i) => (
              <span key={i} className="rounded border border-line bg-surface px-1.5 py-0.5">
                <span className="text-subtle">{i + 1}:</span> {formatNumber(c, 4)}
              </span>
            ))}
          </div>
        ) : (
          <p className="text-xs text-subtle">
            {projection
              ? 'Not part of the subsample used for this projection.'
              : 'No projection computed yet.'}
          </p>
        )}
      </div>

      {dataset.columns.filter((c) => c.role !== 'text' && c.role !== 'image-url').length > 0 && (
        <div>
          <p className="mb-1 text-xs font-medium text-muted">Metadata</p>
          <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 text-xs">
            {dataset.columns
              .filter((c) => c.role !== 'text' && c.role !== 'image-url')
              .map((c) => (
                <div key={c.name} className="contents">
                  <dt className="truncate text-subtle">{c.name}</dt>
                  <dd className="num truncate text-fg/90">
                    {c.values[row] === null ? (
                      <span className="text-subtle">missing</span>
                    ) : typeof c.values[row] === 'number' ? (
                      formatNumber(c.values[row] as number, 4)
                    ) : (
                      String(c.values[row])
                    )}
                  </dd>
                </div>
              ))}
          </dl>
        </div>
      )}

      <div>
        <div className="mb-1 flex items-center justify-between">
          <p className="text-xs font-medium text-muted">Features ({dataset.d})</p>
          {dataset.d > 12 && (
            <button
              type="button"
              className="text-2xs text-accent hover:underline"
              onClick={() => setShowAllFeatures((v) => !v)}
            >
              {showAllFeatures ? 'Show fewer' : 'Show all'}
            </button>
          )}
        </div>
        <dl className="scroll-thin grid max-h-64 grid-cols-[auto_1fr] gap-x-3 gap-y-0.5 overflow-y-auto text-xs">
          {shownFeatures.map((v, t) => (
            <div key={t} className="contents">
              <dt className="truncate text-subtle" title={dataset.featureNames[t]}>
                {dataset.featureNames[t]}
              </dt>
              <dd className="num text-right text-fg/90">{formatNumber(v, 4)}</dd>
            </div>
          ))}
        </dl>
      </div>

      <NeighborList
        title={`Nearest neighbours — feature space (${metric})`}
        hint={
          projection?.rowIndices
            ? 'Among observations in the projected subsample.'
            : 'Distances after the experiment’s preprocessing.'
        }
        neighbors={original}
        dataset={dataset}
      />
      {projected.length > 0 && (
        <NeighborList title="Nearest neighbours — projection" neighbors={projected} dataset={dataset} />
      )}
      {overlap !== null && (
        <p className="text-xs text-subtle">
          <span className="num text-fg">{formatPercent(overlap, 0)}</span> of this point’s {K_NEIGHBORS}{' '}
          feature-space neighbours are also among its {K_NEIGHBORS} nearest neighbours in the projection.
        </p>
      )}
      <Button
        size="sm"
        variant="secondary"
        icon={<ListPlus className="size-3.5" />}
        className="w-full"
        onClick={() => view.setSelection([row, ...original.map((n) => n.row)], 'add')}
      >
        Select point and its feature-space neighbours
      </Button>
    </div>
  );
}

function NeighborList({
  title,
  neighbors,
  dataset,
  hint,
}: {
  title: string;
  neighbors: Neighbor[];
  dataset: Dataset;
  hint?: string;
}) {
  const label = dataset.columns.find((c) => c.role === 'label');
  return (
    <div>
      <p className="text-xs font-medium text-muted">{title}</p>
      {hint && <p className="mb-1 text-2xs text-subtle">{hint}</p>}
      <ol className="space-y-px">
        {neighbors.map((n, i) => (
          <li key={n.row}>
            <button
              type="button"
              onClick={() => useViewStore.getState().setFocus(n.row)}
              onMouseEnter={() => useViewStore.getState().setHover(n.row)}
              onMouseLeave={() => useViewStore.getState().setHover(null)}
              className="grid w-full grid-cols-[1.25rem_1fr_auto] items-center gap-2 rounded px-1 py-0.5 text-left text-xs hover:bg-elevated"
            >
              <span className="num text-subtle">{i + 1}</span>
              <span className="truncate text-fg/90">
                <span className="num">{dataset.ids[n.row]}</span>
                {label && label.values[n.row] !== null && (
                  <span className="text-subtle"> · {String(label.values[n.row])}</span>
                )}
              </span>
              <span className="num text-subtle">{formatNumber(n.distance, 3)}</span>
            </button>
          </li>
        ))}
      </ol>
    </div>
  );
}

function SelectionSummary({ dataset, rows }: { dataset: Dataset; rows: number[] }) {
  const mapping = useColorMapping(dataset);
  const composition = useMemo(() => {
    if (!mapping || mapping.mode !== 'categorical') return null;
    const counts = new Map<number, number>();
    for (const r of rows)
      counts.set(mapping.categoryIndex[r]!, (counts.get(mapping.categoryIndex[r]!) ?? 0) + 1);
    return [...counts.entries()]
      .sort((a, b) => b[1] - a[1])
      .map(([idx, count]) => ({
        label: mapping.categories[idx]?.label ?? 'missing',
        value: count,
        color: mapping.categories[idx]?.color,
      }));
  }, [mapping, rows]);

  // Features where the selection differs most from the full dataset, in pooled standard deviations.
  const signature = useMemo(() => {
    const { d, n, values } = dataset;
    if (rows.length === 0 || rows.length === n) return [];
    const out: { name: string; z: number }[] = [];
    for (let t = 0; t < d; t++) {
      let mean = 0;
      let sq = 0;
      for (let i = 0; i < n; i++) {
        const v = values[i * d + t]!;
        mean += v;
        sq += v * v;
      }
      mean /= n;
      const sd = Math.sqrt(Math.max(sq / n - mean * mean, 0));
      if (sd === 0) continue;
      let sel = 0;
      for (const r of rows) sel += values[r * d + t]!;
      sel /= rows.length;
      out.push({ name: dataset.featureNames[t]!, z: (sel - mean) / sd });
    }
    return out.sort((a, b) => Math.abs(b.z) - Math.abs(a.z)).slice(0, 6);
  }, [dataset, rows]);

  return (
    <Section title={`Selection (${formatInteger(rows.length)})`} icon={<ListPlus />}>
      {composition && (
        <div>
          <p className="mb-1.5 text-xs font-medium text-muted">Composition by {mapping!.title}</p>
          <HorizontalBars data={composition} ariaLabel="Selection composition" maxBars={10} />
        </div>
      )}
      {signature.length > 0 && (
        <div>
          <p className="mb-1 text-xs font-medium text-muted">Most distinctive features</p>
          <p className="mb-1.5 text-2xs text-subtle">
            Difference between the selection mean and the dataset mean, in dataset standard deviations (raw
            features).
          </p>
          <ul className="space-y-0.5 text-xs">
            {signature.map((s) => (
              <li key={s.name} className="flex justify-between gap-2">
                <span className="truncate text-fg/90">{s.name}</span>
                <span className={`num ${s.z > 0 ? 'text-teal' : 'text-violet'}`}>
                  {s.z > 0 ? '+' : ''}
                  {s.z.toFixed(2)} σ
                </span>
              </li>
            ))}
          </ul>
        </div>
      )}
      <div className="flex gap-2">
        <Button
          size="xs"
          variant="ghost"
          onClick={() => useViewStore.getState().setIsolate(!useViewStore.getState().isolateSelection)}
        >
          Toggle isolate
        </Button>
        <Button size="xs" variant="ghost" onClick={() => useViewStore.getState().clearSelection()}>
          Clear selection
        </Button>
      </div>
    </Section>
  );
}

/**
 * Per-category descriptive statistics: size and mean distance to the category centroid in both
 * the raw feature space and the projection. Spreads in different spaces are not comparable in
 * absolute terms; the ratio between categories within one space is what is informative.
 */
function ClusterStatistics({
  dataset,
  projection,
}: {
  dataset: Dataset;
  projection: ReturnType<typeof useDisplayedProjection>;
}) {
  const mapping = useColorMapping(dataset);
  const stats = useMemo(() => {
    if (!mapping || mapping.mode !== 'categorical' || mapping.categories.length > 40) return null;
    const c = mapping.categories.length;
    const { n, d, values } = dataset;
    const counts = new Float64Array(c);
    const centroids = new Float64Array(c * d);
    for (let i = 0; i < n; i++) {
      const k = mapping.categoryIndex[i]!;
      if (k < 0) continue;
      counts[k]!++;
      for (let t = 0; t < d; t++) centroids[k * d + t]! += values[i * d + t]!;
    }
    for (let k = 0; k < c; k++) for (let t = 0; t < d; t++) centroids[k * d + t]! /= counts[k]! || 1;
    const spread = new Float64Array(c);
    for (let i = 0; i < n; i++) {
      const k = mapping.categoryIndex[i]!;
      if (k < 0) continue;
      let s = 0;
      for (let t = 0; t < d; t++) s += (values[i * d + t]! - centroids[k * d + t]!) ** 2;
      spread[k]! += Math.sqrt(s);
    }
    let projSpread: Float64Array | null = null;
    if (projection) {
      const dims = projection.dims;
      const count = projection.coords.length / dims;
      const pc = new Float64Array(c * dims);
      const pn = new Float64Array(c);
      for (let r = 0; r < count; r++) {
        const k = mapping.categoryIndex[projection.rowIndices ? projection.rowIndices[r]! : r]!;
        if (k < 0) continue;
        pn[k]!++;
        for (let t = 0; t < dims; t++) pc[k * dims + t]! += projection.coords[r * dims + t]!;
      }
      for (let k = 0; k < c; k++) for (let t = 0; t < dims; t++) pc[k * dims + t]! /= pn[k]! || 1;
      projSpread = new Float64Array(c);
      for (let r = 0; r < count; r++) {
        const k = mapping.categoryIndex[projection.rowIndices ? projection.rowIndices[r]! : r]!;
        if (k < 0) continue;
        let s = 0;
        for (let t = 0; t < dims; t++) s += (projection.coords[r * dims + t]! - pc[k * dims + t]!) ** 2;
        projSpread[k]! += Math.sqrt(s);
      }
      for (let k = 0; k < c; k++) projSpread[k]! /= pn[k]! || 1;
    }
    return mapping.categories
      .filter((cat) => cat.key !== MISSING_KEY)
      .map((cat, k) => ({
        cat,
        count: counts[k]!,
        spread: spread[k]! / (counts[k]! || 1),
        projSpread: projSpread ? projSpread[k]! : null,
      }));
  }, [dataset, mapping, projection]);

  if (!stats || !mapping) return null;
  return (
    <Section title="Category statistics" icon={<Sigma />} defaultOpen={false}>
      <p className="text-2xs leading-relaxed text-subtle">
        Grouped by <span className="text-muted">{mapping.title}</span>. Spread = mean distance to the category
        centroid; compare categories within a column, not across spaces.
      </p>
      <div className="scroll-thin overflow-x-auto">
        <table className="w-full text-xs">
          <thead>
            <tr className="text-left text-2xs text-subtle">
              <th className="py-1 pr-2 font-medium">Category</th>
              <th className="py-1 pr-2 text-right font-medium">n</th>
              <th className="py-1 pr-2 text-right font-medium">Feature spread</th>
              <th className="py-1 text-right font-medium">Proj. spread</th>
            </tr>
          </thead>
          <tbody>
            {stats.map((s) => (
              <tr key={s.cat.key} className="border-t border-line/60 hover:bg-elevated/60">
                <td className="py-1 pr-2">
                  <button
                    type="button"
                    className="flex items-center gap-1.5 text-left hover:text-accent"
                    onClick={() =>
                      useViewStore
                        .getState()
                        .setSelection(
                          Array.from(mapping.categoryIndex).flatMap((c, i) =>
                            mapping.categories[c]?.key === s.cat.key ? [i] : [],
                          ),
                        )
                    }
                  >
                    <span className="size-2 rounded-full" style={{ background: s.cat.color }} />
                    <span className="truncate">{s.cat.label}</span>
                  </button>
                </td>
                <td className="num py-1 pr-2 text-right">{s.count}</td>
                <td className="num py-1 pr-2 text-right">{formatNumber(s.spread, 3)}</td>
                <td className="num py-1 text-right">
                  {s.projSpread === null ? '—' : formatNumber(s.projSpread, 3)}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className="text-2xs text-subtle">Click a category to select its observations.</p>
    </Section>
  );
}

function DatasetStatistics({ dataset }: { dataset: Dataset }) {
  const label = dataset.columns.find((c) => c.role === 'label' && c.kind !== 'numeric');
  const classes = useMemo(() => {
    if (!label) return null;
    const counts = new Map<string, number>();
    for (const v of label.values) {
      const key = v === null ? 'missing' : String(v);
      counts.set(key, (counts.get(key) ?? 0) + 1);
    }
    return [...counts.entries()].sort((a, b) => b[1] - a[1]).map(([k, v]) => ({ label: k, value: v }));
  }, [label]);
  const metadataMissing = dataset.columns.reduce((s, c) => s + c.values.filter((v) => v === null).length, 0);
  return (
    <Section title="Dataset statistics" icon={<BarChart3 />} defaultOpen={false}>
      <div className="grid grid-cols-2 gap-2">
        <Stat label="Observations" value={formatInteger(dataset.n)} />
        <Stat label="Dimensions" value={formatInteger(dataset.d)} />
        <Stat
          label="Classes"
          value={classes ? classes.filter((c) => c.label !== 'missing').length : '—'}
          hint={label ? label.name : 'no label column'}
        />
        <Stat
          label="Missing values"
          value={formatInteger(metadataMissing)}
          hint="metadata (features are complete)"
        />
      </div>
      {classes && (
        <div>
          <p className="mb-1.5 text-xs font-medium text-muted">Class distribution</p>
          <HorizontalBars data={classes} ariaLabel="Class distribution" maxBars={15} />
        </div>
      )}
      <Button size="xs" variant="ghost" onClick={() => useUiStore.getState().setBottomTab('distributions')}>
        Feature summaries →
      </Button>
    </Section>
  );
}

function MetricsGlance({ experiment }: { experiment: Experiment }) {
  const m = experiment.metrics;
  return (
    <Section title="Quality metrics" icon={<Gauge />} defaultOpen={false}>
      {m ? (
        <div className="grid grid-cols-2 gap-2">
          <Stat
            label={`Trustworthiness@${m.k}`}
            value={formatNumber(m.trustworthiness?.value, 3)}
            hint={m.trustworthiness?.approximate ? 'sampled' : 'exact'}
          />
          <Stat
            label={`Neighbourhood@${m.k}`}
            value={formatNumber(m.neighborhoodPreservation?.value, 3)}
            hint={m.neighborhoodPreservation?.approximate ? 'sampled' : 'exact'}
          />
          <Stat label="Distance ρ" value={formatNumber(m.distanceCorrelation?.value, 3)} hint="Spearman" />
          <Stat
            label="Silhouette (proj.)"
            value={formatNumber(m.silhouetteProjected?.value, 3)}
            hint={m.silhouetteLabelColumn ?? 'no labels'}
          />
        </div>
      ) : (
        <p className="text-xs text-subtle">Not computed yet.</p>
      )}
      <Button size="xs" variant="ghost" onClick={() => useUiStore.getState().setBottomTab('metrics')}>
        Details and settings →
      </Button>
    </Section>
  );
}
