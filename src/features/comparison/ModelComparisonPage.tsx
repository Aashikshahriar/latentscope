import { Brain, Play } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import { Button } from '@/components/ui/Button';
import { Badge, Callout, EmptyState, ProgressBar, Stat } from '@/components/ui/Feedback';
import { Checkbox, NumberField, Segmented, Select, Switch } from '@/components/ui/Form';
import { ScatterPlot } from '@/components/charts/Charts';
import { MathTex } from '@/components/common/MathTex';
import type { AlgorithmId } from '@/types/algorithms';
import type { Dataset } from '@/types/dataset';
import type { Experiment } from '@/types/experiment';
import type { MetricValue, RepresentationComparison } from '@/types/metrics';
import { currentParams, useConfigStore } from '@/stores/configStore';
import { useDatasetStore } from '@/stores/datasetStore';
import { useExperimentStore } from '@/stores/experimentStore';
import { useViewStore } from '@/stores/viewStore';
import { DEMOS } from '@/services/datasets/demos';
import {
  gatherRows,
  matchById,
  matchByOrder,
  type Correspondence,
} from '@/services/experiments/correspondence';
import { ALGORITHM_LABELS, runProjection } from '@/services/experiments/runner';
import { runComputeJob, JobCancelledError } from '@/workers/client';
import { encodeLabels } from '@/algorithms/metrics/silhouette';
import { procrustes } from '@/algorithms/metrics/representation';
import { computeColorMapping } from '@/visualization/common/colorMapping';
import { EmbeddingCanvas } from '@/visualization/EmbeddingCanvas';
import { Legend } from '@/visualization/Legend';
import { formatInteger, formatNumber } from '@/utils/format';
import { errorMessage } from '@/utils/misc';
import { log } from '@/stores/logStore';
import { backgroundCss } from '@/visualization/common/background';
import { MetricValueCell } from '../metrics/MetricsPanel';

function MetricCard({
  title,
  value,
  children,
  tex,
}: {
  title: string;
  value: MetricValue | null | undefined;
  children: React.ReactNode;
  tex?: string;
}) {
  return (
    <div className="rounded-xl border border-line bg-card p-4">
      <p className="text-xs font-semibold text-fg">{title}</p>
      <div className="mt-2">
        <MetricValueCell value={value ?? null} />
      </div>
      {tex && <MathTex tex={tex} display className="text-xs text-muted" />}
      <p className="mt-2 text-xs leading-relaxed text-muted">{children}</p>
    </div>
  );
}

export default function ModelComparisonPage() {
  const datasets = useDatasetStore((s) => s.datasets);
  const view = useViewStore();
  const config = useConfigStore();
  const [idA, setIdA] = useState<string | undefined>();
  const [idB, setIdB] = useState<string | undefined>();
  const [mode, setMode] = useState<'id' | 'order'>('id');
  const [orderConfirmed, setOrderConfirmed] = useState(false);
  const [standardize, setStandardize] = useState(false);
  const [k, setK] = useState(10);
  const [rsaMetric, setRsaMetric] = useState<'euclidean' | 'correlation'>('correlation');
  const [rsaSample, setRsaSample] = useState(800);
  const [clusterK, setClusterK] = useState(8);
  const [labelColumn, setLabelColumn] = useState<string | null>(null);
  const [seed, setSeed] = useState(0);
  const [result, setResult] = useState<RepresentationComparison | null>(null);
  const [job, setJob] = useState<{ cancel: () => void; stage: string; fraction: number | null } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [algorithm, setAlgorithm] = useState<AlgorithmId>('umap');
  const [projections, setProjections] = useState<{ a: string; b: string } | null>(null);
  const [align, setAlign] = useState(true);
  const [selection, setSelection] = useState<number[]>([]);
  const [hover, setHover] = useState<number | null>(null);
  const jobA = useExperimentStore((s) => s.jobs['models:A']);
  const jobB = useExperimentStore((s) => s.jobs['models:B']);
  const projectionJobs = [jobA, jobB];
  const experiments = useExperimentStore((s) => s.experiments);

  const a = idA ? datasets[idA] : undefined;
  const b = idB ? datasets[idB] : undefined;

  const loadPair = async (keys: [string, string]) => {
    setError(null);
    try {
      const [da, db] = await Promise.all(
        keys.map((key) =>
          useDatasetStore.getState().loadDemo(DEMOS.find((d) => d.key === key)!.defaultSpec, false),
        ),
      );
      setIdA(da!.id);
      setIdB(db!.id);
      setMode('id');
      setResult(null);
      setProjections(null);
    } catch (e) {
      setError(errorMessage(e));
    }
  };

  useEffect(() => {
    if (!a) return;
    const label = a.columns.find((c) => c.role === 'label' && c.kind !== 'numeric');
    setLabelColumn(label?.name ?? null);
    if (label) setClusterK(Math.max(2, Math.min(30, new Set(label.values.filter((v) => v !== null)).size)));
  }, [a]);

  const correspondence = useMemo((): { value: Correspondence | null; error: string | null } => {
    if (!a || !b) return { value: null, error: null };
    try {
      return { value: mode === 'id' ? matchById(a, b) : matchByOrder(a, b), error: null };
    } catch (e) {
      return { value: null, error: errorMessage(e) };
    }
  }, [a, b, mode]);
  const corr = correspondence.value;
  const matched = corr?.rowsA.length ?? 0;
  const ready = !!corr && matched >= 4 && (mode === 'id' || orderConfirmed) && a?.id !== b?.id;

  const compute = () => {
    if (!a || !b || !corr) return;
    setError(null);
    setResult(null);
    let labels: Int32Array | null = null;
    const column = a.columns.find((c) => c.name === labelColumn);
    if (column) {
      const values = Array.from(corr.rowsA, (r) => column.values[r] ?? null);
      const { codes, valid } = encodeLabels(values);
      labels = new Int32Array(corr.rowsA.length).fill(-1);
      valid.forEach((row, t) => (labels![row] = codes[t]!));
    }
    const handle = runComputeJob(
      {
        kind: 'compare',
        a: gatherRows(a.values, a.d, corr.rowsA),
        da: a.d,
        b: gatherRows(b.values, b.d, corr.rowsB),
        db: b.d,
        n: corr.rowsA.length,
        labels,
        standardize,
        k,
        maxQueries: 3000,
        rsaSample,
        rsaMetric,
        clusterK,
        seed,
      },
      (p) => setJob((j) => (j ? { ...j, stage: p.stage, fraction: p.fraction } : j)),
    );
    setJob({ cancel: handle.cancel, stage: 'Starting…', fraction: null });
    handle.promise
      .then((r) => {
        setResult(r.comparison);
        log(
          'success',
          `Compared representations “${a.name}” and “${b.name}” on ${corr.rowsA.length} matched observations.`,
        );
      })
      .catch((e) => {
        if (!(e instanceof JobCancelledError)) setError(errorMessage(e));
      })
      .finally(() => setJob(null));
  };

  const project = async () => {
    if (!a || !b) return;
    setError(null);
    try {
      const run = (ds: Dataset, key: string) =>
        runProjection(ds, {
          algorithm,
          params: currentParams({ ...config, algorithm }),
          preprocessing: { ...config.preprocessing, subsample: null },
          outputDims: 2,
          jobKey: key,
          activate: false,
          previews: false,
          autoMetrics: null,
        });
      const [ea, eb] = await Promise.all([run(a, 'models:A'), run(b, 'models:B')]);
      if (ea && eb) setProjections({ a: ea.id, b: eb.id });
    } catch (e) {
      setError(errorMessage(e));
    }
  };

  const expA = projections ? experiments.find((e) => e.id === projections.a) : undefined;
  const expB = projections ? experiments.find((e) => e.id === projections.b) : undefined;

  // Display only corresponding observations; B is optionally Procrustes-aligned onto A.
  const display = useMemo(() => {
    if (!expA || !expB || !corr || !a || !b) return null;
    const pick = (e: Experiment, rows: Uint32Array) => {
      const out = new Float64Array(rows.length * 2);
      rows.forEach((r, i) => out.set([e.coords[r * 2]!, e.coords[r * 2 + 1]!], i * 2));
      return out;
    };
    const ca = pick(expA, corr.rowsA);
    let cb: Float64Array = pick(expB, corr.rowsB);
    let disparity: number | null = null;
    try {
      const res = procrustes(ca, cb, corr.rowsA.length, 2);
      disparity = res.disparity;
      if (align) cb = res.aligned;
    } catch {
      disparity = null;
    }
    return { ca: Float32Array.from(ca), cb: Float32Array.from(cb), disparity };
  }, [expA, expB, corr, align, a, b]);

  const mapping = useMemo(() => {
    if (!a || !corr) return null;
    const colorBy = labelColumn
      ? ({ type: 'column', name: labelColumn } as const)
      : ({ type: 'none' } as const);
    return computeColorMapping(
      a,
      colorBy,
      [],
      view.visuals.categoricalPalette,
      view.visuals.sequentialPalette,
    );
  }, [a, corr, labelColumn, view.visuals.categoricalPalette, view.visuals.sequentialPalette]);

  // Panels address matched observations by their index m ∈ [0, matched); colours come from A.
  const matchedColors = useMemo(() => {
    if (!mapping || !corr) return null;
    const out = new Float32Array(corr.rowsA.length * 3);
    corr.rowsA.forEach((r, i) => out.set(mapping.colors.subarray(r * 3, r * 3 + 3), i * 3));
    return out;
  }, [mapping, corr]);

  const datasetOptions = Object.values(datasets).map((d) => ({
    value: d.id,
    label: d.name,
    description: `${d.n} × ${d.d}`,
  }));
  const labelOptions = a
    ? a.columns.filter((c) => c.kind === 'categorical').map((c) => ({ value: c.name, label: c.name }))
    : [];

  return (
    <div className="scroll-thin h-full overflow-y-auto">
      <div className="mx-auto max-w-[1500px] space-y-5 p-4">
        <div>
          <h1 className="flex items-center gap-2 text-lg font-semibold text-fg">
            <Brain className="size-5 text-accent" aria-hidden /> Model representation comparison
          </h1>
          <p className="mt-1 max-w-3xl text-xs leading-relaxed text-muted">
            Compare two embedding matrices of the <em>same observations</em> — for example two models applied
            to the same inputs, or two modalities of the same trials. Observations are matched explicitly by
            identifier.
          </p>
        </div>

        <div className="flex flex-wrap gap-2">
          <Button size="sm" variant="secondary" onClick={() => void loadPair(['text-minilm', 'text-bge'])}>
            Load demo: MiniLM vs BGE (200 sentences)
          </Button>
          <Button
            size="sm"
            variant="secondary"
            onClick={() => void loadPair(['multimodal-a', 'multimodal-b'])}
          >
            Load demo: synthetic EEG-like vs fMRI-like (480 trials)
          </Button>
        </div>

        <section className="grid gap-4 rounded-xl border border-line bg-card p-4 lg:grid-cols-[1fr_1fr_1.2fr]">
          <Select
            label="Representation A"
            value={idA}
            onChange={(v) => {
              setIdA(v);
              setResult(null);
              setProjections(null);
            }}
            options={datasetOptions}
            placeholder="Choose a loaded dataset"
          />
          <Select
            label="Representation B"
            value={idB}
            onChange={(v) => {
              setIdB(v);
              setResult(null);
              setProjections(null);
            }}
            options={datasetOptions}
            placeholder="Choose a loaded dataset"
          />
          <div className="space-y-2">
            <Segmented
              ariaLabel="Correspondence"
              value={mode}
              onChange={(v) => {
                setMode(v);
                setOrderConfirmed(false);
                setResult(null);
              }}
              options={[
                { value: 'id', label: 'Match by identifier' },
                { value: 'order', label: 'Match by row order' },
              ]}
            />
            {mode === 'order' && (
              <Checkbox
                checked={orderConfirmed}
                onChange={setOrderConfirmed}
                label="I confirm both files list the same observations in the same order"
                description="Row order is never assumed silently; without stable identifiers this cannot be verified."
              />
            )}
          </div>
          {datasetOptions.length < 2 && (
            <p className="text-xs text-subtle lg:col-span-3">
              Load at least two datasets (in the Explorer or Datasets page), or use one of the demo pairs
              above.
            </p>
          )}
        </section>

        {correspondence.error && <Callout tone="danger">{correspondence.error}</Callout>}
        {a && b && a.id === b.id && (
          <Callout tone="warning">
            A and B are the same dataset; choose two different representations.
          </Callout>
        )}
        {corr && a && b && a.id !== b.id && (
          <div className="grid gap-3 sm:grid-cols-3">
            <Stat
              label="Matched observations"
              value={formatInteger(matched)}
              hint={corr.mode === 'id' ? 'by identical identifier' : 'by row position (confirmed)'}
            />
            <Stat
              label="Only in A"
              value={formatInteger(corr.unmatchedA.length)}
              hint={corr.unmatchedA.slice(0, 3).join(', ') || '—'}
            />
            <Stat
              label="Only in B"
              value={formatInteger(corr.unmatchedB.length)}
              hint={corr.unmatchedB.slice(0, 3).join(', ') || '—'}
            />
          </div>
        )}
        {corr && matched < 4 && a && b && a.id !== b.id && (
          <Callout tone="danger">
            Fewer than 4 observations match. Representations must share observation identifiers (or be
            confirmed to share row order).
          </Callout>
        )}

        <section className="space-y-4 rounded-xl border border-line bg-card p-4" aria-labelledby="repsim">
          <div>
            <h2 id="repsim" className="text-sm font-semibold">
              Representation similarity{' '}
              <span className="font-normal text-subtle">— computed in the original feature spaces</span>
            </h2>
          </div>
          <div className="flex flex-wrap items-end gap-3">
            <NumberField
              className="w-20"
              label="k"
              value={k}
              integer
              min={1}
              max={100}
              onChange={(v) => setK(v ?? 10)}
            />
            <div className="w-40">
              <Select
                label="RSA dissimilarity"
                value={rsaMetric}
                onChange={(v) => setRsaMetric(v as 'euclidean' | 'correlation')}
                options={[
                  { value: 'correlation', label: '1 − Pearson r' },
                  { value: 'euclidean', label: 'Euclidean' },
                ]}
              />
            </div>
            <NumberField
              className="w-28"
              label="RSA sample"
              value={rsaSample}
              integer
              min={10}
              max={3000}
              onChange={(v) => setRsaSample(v ?? 800)}
              hint="RDMs grow as m²; larger datasets use a seeded subset."
            />
            <NumberField
              className="w-28"
              label="Clusters (k-means)"
              value={clusterK}
              integer
              min={0}
              max={50}
              onChange={(v) => setClusterK(v ?? 0)}
              hint="0 disables the cluster-distribution comparison."
            />
            <div className="w-40">
              <Select
                label="Labels (from A)"
                value={labelColumn ?? '__none__'}
                onChange={(v) => setLabelColumn(v === '__none__' ? null : v)}
                options={[{ value: '__none__', label: 'None' }, ...labelOptions]}
              />
            </div>
            <NumberField
              className="w-20"
              label="Seed"
              value={seed}
              integer
              onChange={(v) => setSeed(v ?? 0)}
            />
            <div className="pb-1">
              <Switch label="Standardise features" checked={standardize} onChange={setStandardize} />
            </div>
            {job ? (
              <Button variant="danger" onClick={job.cancel}>
                Cancel
              </Button>
            ) : (
              <Button
                variant="primary"
                icon={<Play className="size-3.5" />}
                disabled={!ready}
                onClick={compute}
              >
                Compare representations
              </Button>
            )}
          </div>
          {job && (
            <div className="space-y-1" aria-live="polite">
              <p className="text-xs text-muted">{job.stage}</p>
              <ProgressBar value={job.fraction} label="Comparison progress" />
            </div>
          )}
          {error && <Callout tone="danger">{error}</Callout>}
          {result?.warnings.map((w) => (
            <Callout key={w} tone="warning">
              {w}
            </Callout>
          ))}
          {result ? (
            <>
              <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
                <MetricCard
                  title="Linear CKA"
                  value={result.cka}
                  tex="\mathrm{CKA}(X,Y)=\frac{\lVert Y^\top X\rVert_F^2}{\lVert X^\top X\rVert_F\,\lVert Y^\top Y\rVert_F}"
                >
                  1 = identical up to rotation and isotropic scaling (Kornblith et al., 2019). Dominated by
                  high-variance directions and not invariant to arbitrary linear maps.
                </MetricCard>
                <MetricCard title="RSA (Spearman ρ of RDMs)" value={result.rsa}>
                  Agreement of the pairwise-dissimilarity structure (Kriegeskorte et al., 2008), independent
                  of each space’s dimensionality. Depends on the chosen dissimilarity.
                </MetricCard>
                <MetricCard title={`kNN agreement (k = ${result.k})`} value={result.knnAgreement}>
                  Mean fraction of shared k-nearest neighbours: whether both representations consider the same
                  observations similar locally.
                </MetricCard>
                <div className="rounded-xl border border-line bg-card p-4">
                  <p className="text-xs font-semibold text-fg">kNN classification accuracy</p>
                  {result.knnAccuracy ? (
                    <div className="mt-2 space-y-1.5">
                      {result.knnAccuracy.map((acc) => (
                        <div key={acc.name} className="flex items-center gap-2 text-xs">
                          <Badge tone={acc.name === 'A' ? 'accent' : 'teal'}>{acc.name}</Badge>
                          <MetricValueCell value={acc.value} />
                        </div>
                      ))}
                    </div>
                  ) : (
                    <p className="mt-2 text-xs text-subtle">Requires a label column.</p>
                  )}
                  <p className="mt-2 text-xs leading-relaxed text-muted">
                    Leave-one-out k-NN accuracy for “{labelColumn ?? '—'}” — a representation-quality proxy,
                    comparable only for the same labels.
                  </p>
                </div>
              </div>
              <div className="grid gap-4 lg:grid-cols-2">
                <div>
                  <p className="mb-1 text-xs font-medium text-muted">
                    Pairwise distances: A vs B (1 500 sampled pairs)
                  </p>
                  <ScatterPlot
                    points={result.distancePairs}
                    xLabel="Distance in A"
                    yLabel="Distance in B"
                    ariaLabel="Pairwise distances in representation A versus B"
                    color="#C084FC"
                  />
                  <p className="num text-2xs text-subtle">
                    Pearson r = {formatNumber(result.distancePearson, 3)}
                  </p>
                </div>
                {result.clusterAgreement && (
                  <div className="space-y-2">
                    <p className="text-xs font-medium text-muted">
                      Cluster distribution (k-means, k = {result.clusterAgreement.k})
                    </p>
                    <div className="grid grid-cols-3 gap-2">
                      <Stat
                        label="ARI A ↔ B"
                        value={formatNumber(result.clusterAgreement.ariAB, 3)}
                        hint="same partition?"
                      />
                      <Stat
                        label="ARI A ↔ labels"
                        value={formatNumber(result.clusterAgreement.ariALabels, 3)}
                      />
                      <Stat
                        label="ARI B ↔ labels"
                        value={formatNumber(result.clusterAgreement.ariBLabels, 3)}
                      />
                    </div>
                    <p className="text-xs leading-relaxed text-muted">
                      The adjusted Rand index compares partitions: 1 = identical, ≈ 0 = chance. k-means
                      assumes roughly spherical clusters, so a low value can reflect the clustering method
                      rather than the representations.
                    </p>
                  </div>
                )}
              </div>
            </>
          ) : (
            !job && (
              <p className="text-xs text-subtle">
                Choose two representations with matching observations, then compare.
              </p>
            )
          )}
        </section>

        <section className="space-y-4 rounded-xl border border-line bg-card p-4" aria-labelledby="vissim">
          <div className="flex flex-wrap items-end gap-3">
            <div className="mr-auto">
              <h2 id="vissim" className="text-sm font-semibold">
                Side-by-side projections{' '}
                <span className="font-normal text-subtle">— visualization similarity</span>
              </h2>
              <p className="text-2xs text-subtle">
                Selections are linked through the correspondence. Procrustes alignment only rotates, reflects,
                scales and translates B’s picture to ease visual comparison.
              </p>
            </div>
            <div className="w-44">
              <Segmented
                ariaLabel="Projection algorithm"
                size="sm"
                value={algorithm}
                onChange={setAlgorithm}
                options={(['pca', 'tsne', 'umap'] as const).map((x) => ({
                  value: x,
                  label: ALGORITHM_LABELS[x],
                }))}
              />
            </div>
            <Switch label="Procrustes-align B to A" checked={align} onChange={setAlign} />
            <Button
              variant="secondary"
              disabled={!ready || projectionJobs.some(Boolean)}
              onClick={() => void project()}
            >
              Project both (2D)
            </Button>
          </div>
          {projectionJobs.some(Boolean) && <ProgressBar value={null} label="Projecting" />}
          {display && matchedColors && mapping && a && b ? (
            <>
              <div className="grid gap-3 lg:grid-cols-2">
                {(['A', 'B'] as const).map((side) => (
                  <div
                    key={side}
                    className="relative h-[420px] overflow-hidden rounded-lg border border-line"
                  >
                    <div className="absolute top-2 left-2 z-10 flex items-center gap-1.5 rounded-md bg-elevated/90 px-2 py-1 text-xs">
                      <Badge tone={side === 'A' ? 'accent' : 'teal'}>{side}</Badge>
                      <span className="max-w-56 truncate">{side === 'A' ? a.name : b.name}</span>
                    </div>
                    <EmbeddingCanvas
                      coords={side === 'A' ? display.ca : display.cb}
                      dims={2}
                      rowIndices={null}
                      colors={matchedColors}
                      shapes={null}
                      hidden={null}
                      selection={selection}
                      focus={null}
                      hover={hover}
                      visuals={{ ...view.visuals, showLabels: false }}
                      tool={view.tool}
                      background={backgroundCss(view.visuals.background, view.visuals.customBackground)}
                      axisTitles={[
                        `${ALGORITHM_LABELS[algorithm]} 1`,
                        `${ALGORITHM_LABELS[algorithm]} 2`,
                        '',
                      ]}
                      compact
                      ariaLabel={`${ALGORITHM_LABELS[algorithm]} projection of representation ${side}`}
                      onHover={setHover}
                      onPick={(m, mods) =>
                        m !== null && setSelection((s) => (mods.shift ? [...new Set([...s, m])] : [m]))
                      }
                      onSelectRegion={(rows, selMode) =>
                        setSelection((s) =>
                          selMode === 'add'
                            ? [...new Set([...s, ...rows])]
                            : selMode === 'subtract'
                              ? s.filter((x) => !rows.includes(x))
                              : rows,
                        )
                      }
                    />
                    {side === 'B' && (
                      <Legend
                        mapping={mapping}
                        position="top-right"
                        hidden={[]}
                        shapes={false}
                        sequentialPalette={view.visuals.sequentialPalette}
                        maxItems={10}
                      />
                    )}
                  </div>
                ))}
              </div>
              <div className="flex flex-wrap items-center gap-4 text-xs text-muted">
                <span>
                  Procrustes disparity of the two 2D pictures:{' '}
                  <span className="num text-fg">{formatNumber(display.disparity, 4)}</span> (0 = identical
                  shapes)
                </span>
                {selection.length > 0 && (
                  <button
                    type="button"
                    className="text-accent hover:underline"
                    onClick={() => setSelection([])}
                  >
                    Clear {selection.length} linked selection(s)
                  </button>
                )}
                {hover !== null && corr && (
                  <span className="num">
                    {a.ids[corr.rowsA[hover]!]} ↔ {b.ids[corr.rowsB[hover]!]}
                  </span>
                )}
              </div>
              <Callout tone="info">
                Disparity describes how similar the two <em>pictures</em> are. Non-linear projections of
                identical data can still differ by seed, so use the representation-similarity measures above
                to draw conclusions about the models.
              </Callout>
            </>
          ) : (
            <EmptyState title="No projections yet">
              Project both representations with the same algorithm and parameters (taken from the Explorer’s
              settings).
            </EmptyState>
          )}
        </section>
      </div>
    </div>
  );
}
