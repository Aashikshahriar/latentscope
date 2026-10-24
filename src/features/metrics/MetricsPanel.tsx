import { Gauge, Play } from 'lucide-react';
import { useEffect, useState } from 'react';
import { Button } from '@/components/ui/Button';
import { Badge, Callout, EmptyState, ProgressBar } from '@/components/ui/Feedback';
import { NumberField, Select } from '@/components/ui/Form';
import { LineChart, ScatterPlot } from '@/components/charts/Charts';
import type { Dataset } from '@/types/dataset';
import type { Experiment } from '@/types/experiment';
import type { MetricValue } from '@/types/metrics';
import { useConfigStore } from '@/stores/configStore';
import { useExperimentStore } from '@/stores/experimentStore';
import { computeMetrics, defaultLabelColumn } from '@/services/experiments/runner';
import { formatInteger, formatNumber, formatPercent } from '@/utils/format';
import { errorMessage } from '@/utils/misc';

interface MetricRow {
  key: string;
  name: string;
  value: MetricValue | null;
  range: string;
  meaning: string;
  caveat: string;
}

export function MetricValueCell({ value }: { value: MetricValue | null }) {
  if (!value) return <span className="text-subtle">—</span>;
  return (
    <span className="inline-flex items-center gap-1.5">
      <span className="num font-semibold text-fg">{formatNumber(value.value, 4)}</span>
      {value.approximate ? (
        <Badge tone="warning" className="cursor-help">
          <span title={`${value.note ?? 'Sampled'} Seed ${value.seed}.`}>
            sampled {formatInteger(value.sampleSize)}/{formatInteger(value.population)}
          </span>
        </Badge>
      ) : (
        <Badge tone="success">exact</Badge>
      )}
    </span>
  );
}

export function MetricsPanel({
  dataset,
  experiment,
}: {
  dataset: Dataset | null;
  experiment: Experiment | null;
}) {
  const options = useConfigStore((s) => s.metrics);
  const setOptions = useConfigStore((s) => s.setMetrics);
  const job = useExperimentStore((s) => (experiment ? s.jobs[`metrics:${experiment.id}`] : undefined));
  const shepard = useExperimentStore((s) => (experiment ? s.shepard[experiment.id] : undefined));
  const [labelColumn, setLabelColumn] = useState<string | null>(() =>
    dataset ? defaultLabelColumn(dataset) : null,
  );
  const [error, setError] = useState<string | null>(null);
  const datasetId = dataset?.id;
  useEffect(() => {
    if (dataset) setLabelColumn(experiment?.metrics?.silhouetteLabelColumn ?? defaultLabelColumn(dataset));
    // Only when the dataset changes; the user's choice persists otherwise.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [datasetId]);

  if (!dataset || !experiment || experiment.datasetId !== dataset.id) {
    return (
      <EmptyState title="No projection to evaluate" icon={<Gauge />}>
        Run a projection to compute neighbourhood-preservation and cluster metrics.
      </EmptyState>
    );
  }
  const m = experiment.metrics;
  const categorical = dataset.columns.filter((c) => c.kind === 'categorical');
  const rows: MetricRow[] = [
    {
      key: 'trust',
      name: `Trustworthiness (k = ${m?.k ?? options.k})`,
      value: m?.trustworthiness ?? null,
      range: '0–1, higher is better',
      meaning:
        'Penalises points that look like neighbours in the projection but were not neighbours in the original space (false neighbours).',
      caveat: 'Only concerns local neighbourhoods of size k.',
    },
    {
      key: 'cont',
      name: `Continuity (k = ${m?.k ?? options.k})`,
      value: m?.continuity ?? null,
      range: '0–1, higher is better',
      meaning: 'Penalises original neighbours that were torn apart in the projection (missing neighbours).',
      caveat: 'Complements trustworthiness; neither says anything about global layout.',
    },
    {
      key: 'np',
      name: `Neighbourhood preservation (k = ${m?.k ?? options.k})`,
      value: m?.neighborhoodPreservation ?? null,
      range: '0–1, higher is better',
      meaning:
        'Average fraction of each point’s k nearest original neighbours that are also among its k nearest projected neighbours.',
      caveat: 'Rank-based; ignores how far away the non-preserved neighbours ended up.',
    },
    {
      key: 'dc',
      name: 'Distance correlation (Spearman ρ)',
      value: m?.distanceCorrelation ?? null,
      range: '−1–1',
      meaning: 'Rank correlation between pairwise distances in the original space and in the projection.',
      caveat:
        'Not a complete quality measure: t-SNE and UMAP intentionally distort large distances, so a low value is expected and not necessarily a flaw.',
    },
    {
      key: 'so',
      name: 'Silhouette — original space',
      value: m?.silhouetteOriginal ?? null,
      range: '−1–1',
      meaning: `How well the ${m?.silhouetteLabelColumn ?? 'label'} groups separate in the preprocessed feature space.`,
      caveat: 'Depends on the labels being meaningful groups and on Euclidean geometry.',
    },
    {
      key: 'sp',
      name: 'Silhouette — projection',
      value: m?.silhouetteProjected ?? null,
      range: '−1–1',
      meaning: 'The same score computed on the projected coordinates.',
      caveat:
        'A higher projected than original silhouette means the projection exaggerates separation; it is not evidence that the original representation clusters that strongly.',
    },
  ];

  const run = async () => {
    setError(null);
    try {
      await computeMetrics(experiment, dataset, options, labelColumn);
    } catch (e) {
      setError(errorMessage(e));
    }
  };

  const d = experiment.diagnostics;
  return (
    <div className="grid gap-4 p-4 xl:grid-cols-[minmax(0,1.6fr)_minmax(0,1fr)]">
      <div className="min-w-0 space-y-3">
        <div className="flex flex-wrap items-end gap-3">
          <NumberField
            className="w-24"
            label="k"
            value={options.k}
            integer
            min={1}
            max={200}
            onChange={(v) => setOptions({ k: v ?? 10 })}
            hint="Neighbourhood size for the rank-based metrics. Must be below N / 2."
          />
          <NumberField
            className="w-28"
            label="Query points"
            value={options.maxQueries}
            integer
            min={50}
            max={50000}
            onChange={(v) => setOptions({ maxQueries: v ?? 1000 })}
            hint="Larger datasets use a seeded subset of query points; ranks are always computed against all points."
          />
          <NumberField
            className="w-24"
            label="Seed"
            value={options.seed}
            integer
            onChange={(v) => setOptions({ seed: v ?? 0 })}
          />
          <div className="w-48">
            <Select
              label="Labels for silhouette"
              value={labelColumn ?? '__none__'}
              onChange={(v) => setLabelColumn(v === '__none__' ? null : v)}
              options={[
                { value: '__none__', label: 'None' },
                ...categorical.map((c) => ({ value: c.name, label: c.name })),
              ]}
            />
          </div>
          {job ? (
            <Button variant="danger" size="md" onClick={job.cancel}>
              Cancel
            </Button>
          ) : (
            <Button variant="primary" icon={<Play className="size-3.5" />} onClick={() => void run()}>
              {m ? 'Recompute' : 'Compute metrics'}
            </Button>
          )}
        </div>
        {job && (
          <div className="space-y-1" aria-live="polite">
            <p className="text-xs text-muted">{job.progress?.stage ?? 'Starting…'}</p>
            <ProgressBar value={job.progress?.fraction ?? null} label="Metrics progress" />
          </div>
        )}
        {error && <Callout tone="danger">{error}</Callout>}
        {m?.warnings.map((w) => (
          <Callout key={w} tone="warning">
            {w}
          </Callout>
        ))}
        <div className="scroll-thin overflow-x-auto rounded-lg border border-line">
          <table className="w-full min-w-[640px] text-xs">
            <thead className="bg-surface text-left text-2xs text-subtle uppercase">
              <tr>
                <th className="px-3 py-2 font-medium">Metric</th>
                <th className="px-3 py-2 font-medium">Value</th>
                <th className="px-3 py-2 font-medium">Interpretation</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.key} className="border-t border-line align-top">
                  <td className="px-3 py-2">
                    <p className="font-medium text-fg">{r.name}</p>
                    <p className="text-2xs text-subtle">{r.range}</p>
                  </td>
                  <td className="px-3 py-2 whitespace-nowrap">
                    <MetricValueCell value={r.value} />
                  </td>
                  <td className="px-3 py-2 leading-relaxed text-muted">
                    {r.meaning} <span className="text-subtle">{r.caveat}</span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <p className="text-2xs leading-relaxed text-subtle">
          Original space = the preprocessed features given to the algorithm (
          {experiment.rowIndices
            ? `the ${formatInteger(experiment.rowIndices.length)}-point subsample`
            : 'all observations'}
          ). Metrics follow scikit-learn’s definitions and are verified against it in the test suite.
        </p>
      </div>

      <div className="min-w-0 space-y-4">
        {shepard && shepard.length > 0 && (
          <div>
            <p className="mb-1 text-xs font-medium text-muted">Shepard diagram (sampled pairs)</p>
            <ScatterPlot
              points={shepard}
              xLabel="Original distance"
              yLabel="Projected distance"
              ariaLabel="Shepard diagram of original versus projected pairwise distances"
            />
          </div>
        )}
        {d.kind === 'pca' && <PcaDiagnosticsView experiment={experiment} dataset={dataset} />}
        {d.kind === 'tsne' && d.klHistory.length > 1 && (
          <div>
            <p className="mb-1 text-xs font-medium text-muted">KL divergence during optimisation</p>
            <LineChart
              series={[
                {
                  name: 'KL',
                  color: '#38D9C5',
                  points: d.klHistory.map((h) => ({ x: h.iteration, y: h.kl })),
                },
              ]}
              xLabel="Iteration"
              yLabel="KL(P‖Q)"
              ariaLabel="KL divergence over iterations"
            />
            <p className="num mt-1 text-2xs text-subtle">
              final KL {formatNumber(d.klDivergence, 4)} · effective perplexity{' '}
              {formatNumber(d.effectivePerplexity, 3)} · learning rate {formatNumber(d.learningRate, 4)}
            </p>
          </div>
        )}
        {d.kind === 'umap' && (
          <p className="text-xs text-subtle">
            UMAP ran {d.epochs} epochs with {d.knnMethod === 'exact' ? 'exact' : 'approximate (NN-descent)'}{' '}
            neighbours. umap-js uses random initialisation, unlike umap-learn’s spectral default.
          </p>
        )}
      </div>
    </div>
  );
}

function PcaDiagnosticsView({ experiment, dataset }: { experiment: Experiment; dataset: Dataset }) {
  const d = experiment.diagnostics;
  const [component, setComponent] = useState(0);
  if (d.kind !== 'pca') return null;
  const ratios = d.explainedVarianceRatio;
  let cum = 0;
  const cumulative = ratios.map((r, i) => {
    cum += r;
    return { x: i + 1, y: cum };
  });
  const loadings = d.components[component] ?? [];
  const top = loadings
    .map((v, t) => ({ name: dataset.featureNames[t] ?? `feature_${t}`, v }))
    .sort((a, b) => Math.abs(b.v) - Math.abs(a.v))
    .slice(0, 10);
  const maxAbs = Math.max(...top.map((t) => Math.abs(t.v)), 1e-12);
  return (
    <div className="space-y-4">
      <div>
        <p className="mb-1 text-xs font-medium text-muted">Scree plot and cumulative explained variance</p>
        <LineChart
          bars={ratios.map((r, i) => ({
            x: i + 1,
            y: r,
            color: i < experiment.outputDims ? '#7C8CFF' : '#34425b',
          }))}
          series={[{ name: 'cumulative', color: '#38D9C5', points: cumulative, markers: true }]}
          yDomain={[0, 1]}
          xLabel="Component"
          yLabel="Variance ratio"
          ariaLabel="Scree plot"
        />
        <p className="num mt-1 text-2xs text-subtle">
          Displayed components explain{' '}
          {formatPercent(ratios.slice(0, experiment.outputDims).reduce((s, v) => s + v, 0))} of the total
          variance ({d.method}, rank {d.rank}).
        </p>
      </div>
      <div>
        <div className="mb-1.5 flex items-center justify-between">
          <p className="text-xs font-medium text-muted">Largest loadings</p>
          <div className="flex gap-1">
            {d.components.slice(0, Math.max(experiment.outputDims, 3)).map((_, i) => (
              <button
                key={i}
                type="button"
                aria-pressed={component === i}
                onClick={() => setComponent(i)}
                className={`rounded px-1.5 py-0.5 text-2xs ${component === i ? 'bg-accent/20 text-accent' : 'text-subtle hover:text-fg'}`}
              >
                PC{i + 1}
              </button>
            ))}
          </div>
        </div>
        <ul className="space-y-0.5">
          {top.map((t) => (
            <li
              key={t.name}
              className="grid grid-cols-[minmax(0,7rem)_1fr_3.5rem] items-center gap-2 text-xs"
            >
              <span className="truncate text-muted" title={t.name}>
                {t.name}
              </span>
              <div className="relative h-2 rounded-full bg-line/50">
                <div
                  className="absolute top-0 h-2 rounded-full"
                  style={{
                    left: t.v >= 0 ? '50%' : `${50 - (Math.abs(t.v) / maxAbs) * 50}%`,
                    width: `${(Math.abs(t.v) / maxAbs) * 50}%`,
                    background: t.v >= 0 ? '#38D9C5' : '#C084FC',
                  }}
                />
                <div className="absolute top-[-2px] left-1/2 h-3 w-px bg-line-strong" />
              </div>
              <span className="num text-right text-fg/90">{t.v.toFixed(3)}</span>
            </li>
          ))}
        </ul>
        <p className="mt-1 text-2xs text-subtle">
          Loadings are unit-norm direction weights; signs are arbitrary up to a joint flip of the component.
        </p>
      </div>
    </div>
  );
}
