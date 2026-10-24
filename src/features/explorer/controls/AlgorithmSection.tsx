import { FlaskConical, Play, Square } from 'lucide-react';
import { useMemo, useState } from 'react';
import { Link } from 'react-router';
import { Button } from '@/components/ui/Button';
import { Badge, Callout, ProgressBar } from '@/components/ui/Feedback';
import { Checkbox, NumberField, Segmented, Select, Switch } from '@/components/ui/Form';
import { Section } from '@/components/ui/Overlay';
import { currentParams, useConfigStore } from '@/stores/configStore';
import { useActiveDataset } from '@/stores/datasetStore';
import { useExperimentStore } from '@/stores/experimentStore';
import { estimateCost, runProjection, validateRun, ALGORITHM_LABELS } from '@/services/experiments/runner';
import type { AlgorithmId } from '@/types/algorithms';
import { formatDuration } from '@/utils/format';
import { errorMessage } from '@/utils/misc';
import { TSNE_EXACT_LIMIT } from '@/algorithms/tsne/tsne';

const ALGORITHM_NOTES: Record<AlgorithmId, string> = {
  pca: 'Linear projection onto the directions of greatest variance. Distances along the axes are meaningful; non-linear structure is not unfolded.',
  tsne: 'Preserves local neighbourhoods. Distances between clusters, cluster sizes and densities in the result are not reliable.',
  umap: 'Approximates the fuzzy neighbourhood graph. Local structure is reliable; global distances are only loosely preserved.',
};

export function AlgorithmSection() {
  const dataset = useActiveDataset();
  const config = useConfigStore();
  const job = useExperimentStore((s) => s.jobs.projection);
  const [runError, setRunError] = useState<string | null>(null);
  const [advanced, setAdvanced] = useState(false);

  const params = currentParams(config);
  const rows = dataset
    ? config.preprocessing.subsample
      ? Math.min(dataset.n, config.preprocessing.subsample.size)
      : dataset.n
    : 0;
  const validation = useMemo(
    () => (dataset ? validateRun(config.algorithm, params, rows) : { errors: [], warnings: [] }),
    [dataset, config.algorithm, params, rows],
  );
  const cost = dataset
    ? estimateCost(
        config.algorithm,
        dataset.n,
        dataset.d,
        params,
        config.preprocessing.subsample?.size ?? null,
      )
    : null;
  const subsample = config.preprocessing.subsample;

  const run = async () => {
    if (!dataset) return;
    setRunError(null);
    try {
      await runProjection(dataset, {
        algorithm: config.algorithm,
        params,
        preprocessing: config.preprocessing,
        outputDims: config.outputDims,
        autoMetrics: config.autoMetrics ? config.metrics : null,
      });
    } catch (e) {
      setRunError(errorMessage(e));
    }
  };

  const elapsed = job ? performance.now() - job.startedAt : 0;
  const progress = job?.progress;

  return (
    <Section title="Projection" icon={<FlaskConical />}>
      <Segmented
        ariaLabel="Algorithm"
        value={config.algorithm}
        onChange={config.setAlgorithm}
        options={[
          { value: 'pca', label: 'PCA' },
          { value: 'tsne', label: 't-SNE' },
          { value: 'umap', label: 'UMAP' },
        ]}
      />
      <p className="text-xs leading-relaxed text-subtle">
        {ALGORITHM_NOTES[config.algorithm]}{' '}
        <Link to={`/learn/${config.algorithm}`} className="text-accent hover:underline">
          How it works
        </Link>
      </p>
      <Segmented
        ariaLabel="Output dimensions"
        size="sm"
        value={String(config.outputDims) as '2' | '3'}
        onChange={(v) => config.setOutputDims(Number(v) as 2 | 3)}
        options={[
          { value: '2', label: '2D projection' },
          { value: '3', label: '3D projection' },
        ]}
      />

      {config.algorithm === 'pca' && (
        <div className="grid grid-cols-2 gap-2.5">
          <Select
            label="Solver"
            hint="Auto chooses an exact method (SVD, covariance or Gram eigendecomposition) by matrix shape. Randomized SVD is approximate but fast for very large inputs."
            value={config.pca.solver}
            onChange={(v) => config.setPca({ solver: v })}
            options={[
              { value: 'auto', label: 'Auto (exact)' },
              { value: 'exact', label: 'Exact only' },
              { value: 'randomized', label: 'Randomized' },
            ]}
          />
          <NumberField
            label="Seed"
            value={config.pca.seed}
            integer
            hint="Used only by the randomized solver."
            onChange={(v) => config.setPca({ seed: v ?? 0 })}
          />
        </div>
      )}

      {config.algorithm === 'tsne' && (
        <>
          <div className="grid grid-cols-2 gap-2.5">
            <NumberField
              label="Perplexity"
              value={config.tsne.perplexity}
              min={1}
              step={1}
              hint="Effective number of neighbours each point attends to. Typical values: 5–50. Must be below N."
              onChange={(v) => config.setTsne({ perplexity: v ?? 30 })}
            />
            <NumberField
              label="Iterations"
              value={config.tsne.iterations}
              integer
              min={250}
              max={10000}
              onChange={(v) => config.setTsne({ iterations: v ?? 1000 })}
            />
            <NumberField
              label="Learning rate"
              value={config.tsne.learningRate}
              allowNull
              nullLabel="auto"
              min={1}
              hint="Empty = automatic: max(N / exaggeration / 4, 50)."
              onChange={(v) => config.setTsne({ learningRate: v })}
            />
            <NumberField
              label="Seed"
              value={config.tsne.seed}
              integer
              onChange={(v) => config.setTsne({ seed: v ?? 0 })}
            />
          </div>
          <Select
            label="Initialisation"
            value={config.tsne.init}
            onChange={(v) => config.setTsne({ init: v })}
            options={[
              { value: 'pca', label: 'PCA (deterministic, preserves more global layout)' },
              { value: 'random', label: 'Random (seeded Gaussian)' },
            ]}
          />
          <button
            type="button"
            className="text-xs text-accent hover:underline"
            onClick={() => setAdvanced((a) => !a)}
            aria-expanded={advanced}
          >
            {advanced ? 'Hide' : 'Show'} advanced parameters
          </button>
          {advanced && (
            <div className="grid grid-cols-2 gap-2.5">
              <Select
                label="Gradient"
                value={config.tsne.method}
                hint={`Auto uses exact gradients up to ${TSNE_EXACT_LIMIT} points and Barnes–Hut above.`}
                onChange={(v) => config.setTsne({ method: v })}
                options={[
                  { value: 'auto', label: 'Auto' },
                  { value: 'exact', label: 'Exact O(N²)' },
                  { value: 'barnes-hut', label: 'Barnes–Hut' },
                ]}
              />
              <NumberField
                label="Barnes–Hut θ"
                value={config.tsne.theta}
                min={0.05}
                max={1}
                step={0.05}
                onChange={(v) => config.setTsne({ theta: v ?? 0.5 })}
              />
              <NumberField
                label="Exaggeration"
                value={config.tsne.earlyExaggeration}
                min={1}
                max={64}
                step={1}
                onChange={(v) => config.setTsne({ earlyExaggeration: v ?? 12 })}
              />
              <NumberField
                label="Exaggeration iters"
                value={config.tsne.earlyExaggerationIterations}
                integer
                min={0}
                onChange={(v) => config.setTsne({ earlyExaggerationIterations: v ?? 250 })}
              />
              <NumberField
                label="PCA pre-reduction"
                value={config.tsne.pcaDims}
                integer
                min={0}
                max={500}
                hint="Reduce to this many principal components before computing affinities (0 = off). Common practice for high-dimensional inputs."
                onChange={(v) => config.setTsne({ pcaDims: v ?? 0 })}
              />
            </div>
          )}
        </>
      )}

      {config.algorithm === 'umap' && (
        <>
          <div className="grid grid-cols-2 gap-2.5">
            <NumberField
              label="Neighbours"
              value={config.umap.nNeighbors}
              integer
              min={2}
              hint="Size of the local neighbourhood. Small values emphasise fine local structure; large values more global structure."
              onChange={(v) => config.setUmap({ nNeighbors: v ?? 15 })}
            />
            <NumberField
              label="Min distance"
              value={config.umap.minDist}
              min={0}
              max={1}
              step={0.05}
              hint="How tightly points may be packed in the embedding (0–1)."
              onChange={(v) => config.setUmap({ minDist: v ?? 0.1 })}
            />
            <Select
              label="Metric"
              value={config.umap.metric}
              onChange={(v) => config.setUmap({ metric: v })}
              options={[
                { value: 'euclidean', label: 'Euclidean' },
                { value: 'cosine', label: 'Cosine' },
              ]}
            />
            <NumberField
              label="Seed"
              value={config.umap.seed}
              integer
              onChange={(v) => config.setUmap({ seed: v ?? 0 })}
            />
          </div>
          <button
            type="button"
            className="text-xs text-accent hover:underline"
            onClick={() => setAdvanced((a) => !a)}
            aria-expanded={advanced}
          >
            {advanced ? 'Hide' : 'Show'} advanced parameters
          </button>
          {advanced && (
            <div className="grid grid-cols-2 gap-2.5">
              <NumberField
                label="Spread"
                value={config.umap.spread}
                min={0.1}
                max={5}
                step={0.1}
                onChange={(v) => config.setUmap({ spread: v ?? 1 })}
              />
              <NumberField
                label="Epochs"
                value={config.umap.nEpochs}
                integer
                min={0}
                hint="0 = automatic (500 for ≤ 2 500 points, fewer for larger graphs)."
                onChange={(v) => config.setUmap({ nEpochs: v ?? 0 })}
              />
              <Select
                label="Neighbour search"
                value={config.umap.knn}
                hint="Exact brute-force neighbours (auto for N ≤ 4 000) or umap-js's approximate NN-descent."
                onChange={(v) => config.setUmap({ knn: v })}
                options={[
                  { value: 'auto', label: 'Auto' },
                  { value: 'exact', label: 'Exact' },
                  { value: 'approximate', label: 'NN-descent' },
                ]}
              />
            </div>
          )}
        </>
      )}

      <div className="space-y-2 rounded-lg border border-line bg-surface/60 p-3">
        <p className="text-xs font-medium text-muted">Preprocessing</p>
        <Checkbox
          label="Centre features"
          description={config.algorithm === 'pca' ? 'Always applied for PCA.' : undefined}
          checked={config.algorithm === 'pca' ? true : config.preprocessing.center}
          disabled={config.algorithm === 'pca'}
          onChange={(v) => config.setPreprocessing({ center: v })}
        />
        <Checkbox
          label="Standardise (unit variance)"
          checked={config.preprocessing.standardize}
          onChange={(v) => config.setPreprocessing({ standardize: v })}
        />
        <Checkbox
          label="L2-normalise observations"
          description="Common for embeddings compared by cosine similarity."
          checked={config.preprocessing.l2Normalize}
          onChange={(v) => config.setPreprocessing({ l2Normalize: v })}
        />
        <Checkbox
          label="Use a random subsample"
          description="Explicit, seeded and recorded with the experiment."
          checked={subsample !== null}
          onChange={(v) =>
            config.setPreprocessing({
              subsample: v ? { size: Math.min(dataset?.n ?? 2000, 2000), seed: 0 } : null,
            })
          }
        />
        {subsample && (
          <div className="grid grid-cols-2 gap-2.5">
            <NumberField
              label="Sample size"
              value={subsample.size}
              integer
              min={2}
              max={dataset?.n}
              onChange={(v) => config.setPreprocessing({ subsample: { ...subsample, size: v ?? 2 } })}
            />
            <NumberField
              label="Sample seed"
              value={subsample.seed}
              integer
              onChange={(v) => config.setPreprocessing({ subsample: { ...subsample, seed: v ?? 0 } })}
            />
          </div>
        )}
      </div>

      {validation.errors.map((e) => (
        <Callout key={e} tone="danger">
          {e}
        </Callout>
      ))}
      {validation.warnings.map((w) => (
        <Callout key={w} tone="warning">
          {w}
        </Callout>
      ))}
      {cost && dataset && (
        <div className="flex items-start gap-2 text-xs text-subtle">
          <Badge
            tone={
              cost.level === 'low'
                ? 'success'
                : cost.level === 'moderate'
                  ? 'info'
                  : cost.level === 'high'
                    ? 'warning'
                    : 'danger'
            }
          >
            {cost.summary}
          </Badge>
          <span className="leading-relaxed">{cost.detail}</span>
        </div>
      )}
      {cost?.level === 'very-high' && !subsample && (
        <Callout tone="warning" title="This run may take several minutes">
          You can continue (the interface stays responsive and the run can be cancelled) or enable subsampling
          above.
        </Callout>
      )}

      <Switch
        label="Compute quality metrics after the run"
        checked={config.autoMetrics}
        onChange={config.setAutoMetrics}
      />

      {job ? (
        <div className="space-y-2 rounded-lg border border-accent/30 bg-accent/[0.06] p-3" aria-live="polite">
          <div className="flex items-center justify-between text-xs">
            <span className="font-medium text-fg">{progress?.stage ?? 'Starting worker…'}</span>
            <span className="num text-muted">{formatDuration(elapsed)}</span>
          </div>
          <ProgressBar value={progress?.fraction ?? null} label="Projection progress" />
          {progress?.iteration !== undefined && (
            <p className="num text-2xs text-subtle">
              iteration {progress.iteration} / {progress.total}
              {progress.kl != null && ` · KL ${progress.kl.toFixed(4)}`}
            </p>
          )}
          <Button
            size="sm"
            variant="danger"
            icon={<Square className="size-3" />}
            onClick={job.cancel}
            className="w-full"
          >
            Cancel
          </Button>
        </div>
      ) : (
        <Button
          variant="primary"
          className="w-full"
          icon={<Play className="size-4" />}
          disabled={!dataset || validation.errors.length > 0}
          onClick={() => void run()}
        >
          Run {ALGORITHM_LABELS[config.algorithm]}
        </Button>
      )}
      {runError && <Callout tone="danger">{runError}</Callout>}
    </Section>
  );
}
