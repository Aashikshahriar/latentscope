import { GitCompareArrows, Lasso, MousePointer2, Play, SquareDashed, X } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import { Link, useSearchParams } from 'react-router';
import { Button, IconButton } from '@/components/ui/Button';
import { Badge, Callout, EmptyState, ProgressBar } from '@/components/ui/Feedback';
import { Checkbox, Segmented, Select } from '@/components/ui/Form';
import { useIsDesktop } from '@/hooks/useMediaQuery';
import type { AlgorithmId, OutputDims } from '@/types/algorithms';
import type { Dataset } from '@/types/dataset';
import type { Experiment } from '@/types/experiment';
import { currentParams, useConfigStore } from '@/stores/configStore';
import { useActiveDataset, useDatasetStore } from '@/stores/datasetStore';
import { useExperimentStore } from '@/stores/experimentStore';
import { useViewStore } from '@/stores/viewStore';
import {
  ALGORITHM_LABELS,
  computeMetrics,
  defaultLabelColumn,
  runProjection,
  validateRun,
} from '@/services/experiments/runner';
import { paramsSummary } from '@/services/experiments/describe';
import { DEMOS } from '@/services/datasets/demos';
import { EmbeddingCanvas } from '@/visualization/EmbeddingCanvas';
import { Legend } from '@/visualization/Legend';
import { formatDuration, formatInteger } from '@/utils/format';
import { errorMessage } from '@/utils/misc';
import { axisTitlesFor, useColorMapping, useHiddenMask, useShapes } from '../explorer/useExplorerData';
import { backgroundCss } from '@/visualization/common/background';
import { MetricValueCell } from '../metrics/MetricsPanel';
import { defaultColorBy } from '@/visualization/common/colorMapping';
import { resetViewForDataset } from '@/stores/viewStore';

const ALGORITHMS: AlgorithmId[] = ['pca', 'tsne', 'umap'];

function useComparisonExperiments(
  dataset: Dataset | null,
  dims: OutputDims,
  pinned: string[] | null,
): Partial<Record<AlgorithmId, Experiment>> {
  const experiments = useExperimentStore((s) => s.experiments);
  return useMemo(() => {
    const out: Partial<Record<AlgorithmId, Experiment>> = {};
    if (!dataset) return out;
    if (pinned) {
      for (const id of pinned) {
        const e = experiments.find((x) => x.id === id && x.datasetId === dataset.id);
        if (e && !out[e.algorithm]) out[e.algorithm] = e;
      }
      return out;
    }
    for (const e of experiments) {
      if (e.datasetId !== dataset.id || e.outputDims !== dims || e.datasetChecksum !== dataset.checksum)
        continue;
      if (!out[e.algorithm]) out[e.algorithm] = e; // experiments are sorted newest first
    }
    return out;
  }, [experiments, dataset, dims, pinned]);
}

export default function ComparisonPage() {
  const dataset = useActiveDataset();
  const datasets = useDatasetStore((s) => s.datasets);
  const [params, setParams] = useSearchParams();
  const pinned = useMemo(() => params.get('experiments')?.split(',').filter(Boolean) ?? null, [params]);
  const [dims, setDims] = useState<OutputDims>(2);
  const [enabled, setEnabled] = useState<AlgorithmId[]>(ALGORITHMS);
  const [error, setError] = useState<string | null>(null);
  const [mobileTab, setMobileTab] = useState<AlgorithmId>('pca');
  const isDesktop = useIsDesktop();
  const config = useConfigStore();
  const jobs = useExperimentStore((s) => s.jobs);
  const experiments = useComparisonExperiments(dataset, dims, pinned);
  const mapping = useColorMapping(dataset);
  const hidden = useHiddenMask(dataset, mapping);
  const shapes = useShapes(mapping);
  const view = useViewStore();

  // Pinned experiments (from History) determine the dataset and dimensionality.
  useEffect(() => {
    if (!pinned) return;
    const first = useExperimentStore.getState().experiments.find((e) => pinned.includes(e.id));
    if (first) {
      setDims(first.outputDims);
      if (datasets[first.datasetId]) useDatasetStore.getState().setActive(first.datasetId);
    }
  }, [pinned, datasets]);

  useEffect(() => {
    if (!dataset && Object.keys(datasets).length === 0) {
      void useDatasetStore
        .getState()
        .loadDemo(DEMOS.find((d) => d.key === 'digits')!.defaultSpec)
        .then((ds) => resetViewForDataset(defaultColorBy(ds)));
    }
  }, [dataset, datasets]);

  const missing = enabled.filter((a) => !experiments[a]);
  const runMissing = async () => {
    if (!dataset) return;
    setError(null);
    try {
      await Promise.all(
        missing.map((algorithm) =>
          runProjection(dataset, {
            algorithm,
            params: currentParams({ ...config, algorithm }),
            preprocessing: config.preprocessing,
            outputDims: dims,
            jobKey: `compare:${algorithm}`,
            activate: false,
            previews: false,
            autoMetrics: config.metrics,
          }),
        ),
      );
    } catch (e) {
      setError(errorMessage(e));
    }
  };

  const computeAll = async () => {
    if (!dataset) return;
    setError(null);
    try {
      await Promise.all(
        enabled.flatMap((a) =>
          experiments[a]
            ? [computeMetrics(experiments[a]!, dataset, config.metrics, defaultLabelColumn(dataset))]
            : [],
        ),
      );
    } catch (e) {
      setError(errorMessage(e));
    }
  };

  const validation = dataset
    ? missing.flatMap((a) =>
        validateRun(a, currentParams({ ...config, algorithm: a }), dataset.n).errors.map(
          (e) => `${ALGORITHM_LABELS[a]}: ${e}`,
        ),
      )
    : [];
  const shown = isDesktop ? enabled : enabled.filter((a) => a === mobileTab);

  return (
    <div className="scroll-thin h-full overflow-y-auto">
      <div className="mx-auto max-w-[1600px] space-y-4 p-4">
        <div className="flex flex-wrap items-end gap-3">
          <div className="mr-auto">
            <h1 className="flex items-center gap-2 text-lg font-semibold text-fg">
              <GitCompareArrows className="size-5 text-accent" aria-hidden /> Algorithm comparison
            </h1>
            <p className="text-xs text-muted">
              The same observations projected by different algorithms. Selection, hover, filtering and colours
              are synchronised; coordinate systems are not aligned.
            </p>
          </div>
          <div className="w-64">
            <Select
              label="Dataset"
              value={dataset?.id}
              onChange={(id) => {
                setParams({});
                useDatasetStore.getState().setActive(id);
                const ds = useDatasetStore.getState().datasets[id];
                if (ds) resetViewForDataset(defaultColorBy(ds));
              }}
              options={Object.values(datasets).map((d) => ({
                value: d.id,
                label: d.name,
                description: `${d.n} × ${d.d}`,
              }))}
              placeholder="Load a dataset in the Explorer"
            />
          </div>
          <div className="w-44">
            <Segmented
              ariaLabel="Projection dimensions"
              value={String(dims) as '2' | '3'}
              onChange={(v) => {
                setParams({});
                setDims(Number(v) as OutputDims);
              }}
              options={[
                { value: '2', label: '2D' },
                { value: '3', label: '3D' },
              ]}
            />
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-4 rounded-xl border border-line bg-card px-4 py-3">
          {ALGORITHMS.map((a) => (
            <Checkbox
              key={a}
              label={ALGORITHM_LABELS[a]}
              checked={enabled.includes(a)}
              onChange={(v) =>
                setEnabled((e) =>
                  v ? ALGORITHMS.filter((x) => x === a || e.includes(x)) : e.filter((x) => x !== a),
                )
              }
            />
          ))}
          <span className="mx-1 h-5 w-px bg-line" aria-hidden />
          <div className="flex items-center gap-0.5" role="toolbar" aria-label="Selection tools">
            <IconButton
              label="Navigate"
              icon={<MousePointer2 />}
              active={view.tool === 'navigate'}
              onClick={() => view.setTool('navigate')}
            />
            <IconButton
              label="Rectangle selection"
              icon={<SquareDashed />}
              active={view.tool === 'rectangle'}
              onClick={() => view.setTool('rectangle')}
            />
            <IconButton
              label="Lasso selection"
              icon={<Lasso />}
              active={view.tool === 'lasso'}
              onClick={() => view.setTool('lasso')}
            />
          </div>
          {view.selection.length > 0 && (
            <Button
              size="xs"
              variant="ghost"
              icon={<X className="size-3" />}
              onClick={() => view.clearSelection()}
            >
              {formatInteger(view.selection.length)} selected
            </Button>
          )}
          <div className="ml-auto flex flex-wrap gap-2">
            {missing.length > 0 && (
              <Button
                variant="primary"
                size="sm"
                icon={<Play className="size-3.5" />}
                disabled={!dataset || validation.length > 0 || missing.some((a) => jobs[`compare:${a}`])}
                onClick={() => void runMissing()}
              >
                Compute {missing.map((a) => ALGORITHM_LABELS[a]).join(', ')}
              </Button>
            )}
            <Button variant="secondary" size="sm" disabled={!dataset} onClick={() => void computeAll()}>
              Recompute metrics (k = {config.metrics.k})
            </Button>
            <Link to="/explore">
              <Button variant="ghost" size="sm">
                Edit parameters in Explorer
              </Button>
            </Link>
          </div>
        </div>
        {pinned && (
          <Callout tone="info">
            Comparing experiments selected in History.{' '}
            <button type="button" className="text-accent hover:underline" onClick={() => setParams({})}>
              Show the latest of each algorithm instead
            </button>
          </Callout>
        )}
        {validation.map((v) => (
          <Callout key={v} tone="danger">
            {v}
          </Callout>
        ))}
        {error && <Callout tone="danger">{error}</Callout>}

        {!isDesktop && enabled.length > 1 && (
          <Segmented
            ariaLabel="Projection shown"
            value={mobileTab}
            onChange={setMobileTab}
            options={enabled.map((a) => ({ value: a, label: ALGORITHM_LABELS[a] }))}
          />
        )}

        {!dataset ? (
          <EmptyState title="No dataset loaded" icon={<GitCompareArrows />}>
            Load a dataset in the Explorer first.
          </EmptyState>
        ) : (
          <div
            className={`grid gap-3 ${shown.length === 3 ? 'lg:grid-cols-3' : shown.length === 2 ? 'lg:grid-cols-2' : ''}`}
          >
            {shown.map((a) => {
              const e = experiments[a];
              const job = jobs[`compare:${a}`];
              return (
                <section
                  key={a}
                  className="flex h-[min(56vh,520px)] min-h-[320px] flex-col overflow-hidden rounded-xl border border-line bg-card"
                  aria-label={`${ALGORITHM_LABELS[a]} projection`}
                >
                  <header className="flex items-center gap-2 border-b border-line px-3 py-2">
                    <Badge tone="accent">{ALGORITHM_LABELS[a]}</Badge>
                    <span
                      className="num truncate text-2xs text-subtle"
                      title={e ? paramsSummary(e.params) : undefined}
                    >
                      {e ? `${paramsSummary(e.params)} · ${formatDuration(e.runtimeMs)}` : 'not computed'}
                    </span>
                  </header>
                  <div className="relative min-h-0 flex-1">
                    {e && mapping ? (
                      <>
                        <EmbeddingCanvas
                          coords={e.coords}
                          dims={e.outputDims}
                          rowIndices={e.rowIndices}
                          colors={mapping.colors}
                          shapes={shapes}
                          hidden={hidden}
                          selection={view.selection}
                          focus={view.focus}
                          hover={view.hover}
                          visuals={{ ...view.visuals, showLabels: false }}
                          tool={view.tool}
                          background={backgroundCss(view.visuals.background, view.visuals.customBackground)}
                          axisTitles={axisTitlesFor(e)}
                          compact
                          ariaLabel={`${ALGORITHM_LABELS[a]} projection of ${dataset.name}`}
                          onHover={(row) => view.setHover(row)}
                          onPick={(row, mods) => {
                            view.setFocus(row);
                            if (row !== null && mods.shift) view.setSelection([row], 'add');
                          }}
                          onSelectRegion={(rows, mode) => view.setSelection(rows, mode)}
                        />
                        {a === shown[shown.length - 1] && (
                          <Legend
                            mapping={mapping}
                            position="top-right"
                            hidden={view.hidden}
                            shapes={view.visuals.shapeEncoding}
                            sequentialPalette={view.visuals.sequentialPalette}
                            onToggle={view.toggleHidden}
                            maxItems={10}
                          />
                        )}
                      </>
                    ) : job ? (
                      <div className="grid h-full place-items-center p-6">
                        <div className="w-full max-w-xs space-y-2 text-center">
                          <p className="text-xs text-muted">{job.progress?.stage ?? 'Starting…'}</p>
                          <ProgressBar
                            value={job.progress?.fraction ?? null}
                            label={`${ALGORITHM_LABELS[a]} progress`}
                          />
                          <Button size="xs" variant="ghost" onClick={job.cancel}>
                            Cancel
                          </Button>
                        </div>
                      </div>
                    ) : (
                      <EmptyState title={`No ${dims}D ${ALGORITHM_LABELS[a]} projection`}>
                        Use “Compute” above with the parameters currently set in the Explorer.
                      </EmptyState>
                    )}
                  </div>
                </section>
              );
            })}
          </div>
        )}

        {dataset && view.focus !== null && (
          <p className="text-xs text-muted">
            Focused observation: <span className="num text-fg">{dataset.ids[view.focus]}</span>
            {(() => {
              const label = dataset.columns.find((c) => c.role === 'label');
              return label ? ` · ${label.name} ${String(label.values[view.focus!])}` : '';
            })()}{' '}
            — highlighted in every panel.
          </p>
        )}

        {dataset && (
          <section
            className="overflow-hidden rounded-xl border border-line bg-card"
            aria-labelledby="comparison-metrics"
          >
            <header className="border-b border-line px-4 py-3">
              <h2 id="comparison-metrics" className="text-sm font-semibold">
                Quality metrics
              </h2>
              <p className="text-2xs text-subtle">
                Each projection is evaluated against the preprocessed features it was computed from. Values
                for different k or preprocessing are not directly comparable.
              </p>
            </header>
            <div className="scroll-thin overflow-x-auto">
              <table className="w-full min-w-[720px] text-xs">
                <thead className="bg-surface text-left text-2xs text-subtle uppercase">
                  <tr>
                    <th className="px-4 py-2 font-medium">Metric</th>
                    {enabled.map((a) => (
                      <th key={a} className="px-4 py-2 font-medium">
                        {ALGORITHM_LABELS[a]}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {(
                    [
                      ['Trustworthiness', (e: Experiment) => e.metrics?.trustworthiness ?? null],
                      ['Continuity', (e: Experiment) => e.metrics?.continuity ?? null],
                      [
                        'Neighbourhood preservation',
                        (e: Experiment) => e.metrics?.neighborhoodPreservation ?? null,
                      ],
                      [
                        'Distance correlation (Spearman)',
                        (e: Experiment) => e.metrics?.distanceCorrelation ?? null,
                      ],
                      [
                        'Silhouette — original space',
                        (e: Experiment) => e.metrics?.silhouetteOriginal ?? null,
                      ],
                      ['Silhouette — projection', (e: Experiment) => e.metrics?.silhouetteProjected ?? null],
                    ] as const
                  ).map(([name, get]) => (
                    <tr key={name} className="border-t border-line">
                      <td className="px-4 py-2 text-muted">{name}</td>
                      {enabled.map((a) => (
                        <td key={a} className="px-4 py-2">
                          {experiments[a] ? (
                            <MetricValueCell value={get(experiments[a]!)} />
                          ) : (
                            <span className="text-subtle">—</span>
                          )}
                          {experiments[a] && jobs[`metrics:${experiments[a]!.id}`] && (
                            <span className="ml-2 text-2xs text-subtle">computing…</span>
                          )}
                        </td>
                      ))}
                    </tr>
                  ))}
                  <tr className="border-t border-line">
                    <td className="px-4 py-2 text-muted">Neighbourhood size k</td>
                    {enabled.map((a) => (
                      <td key={a} className="num px-4 py-2">
                        {experiments[a]?.metrics?.k ?? '—'}
                      </td>
                    ))}
                  </tr>
                  <tr className="border-t border-line">
                    <td className="px-4 py-2 text-muted">Runtime</td>
                    {enabled.map((a) => (
                      <td key={a} className="num px-4 py-2">
                        {experiments[a] ? formatDuration(experiments[a]!.runtimeMs) : '—'}
                      </td>
                    ))}
                  </tr>
                </tbody>
              </table>
            </div>
          </section>
        )}
      </div>
    </div>
  );
}
