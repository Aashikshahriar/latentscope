import { Boxes, Trash2 } from 'lucide-react';
import { useState } from 'react';
import { Button, IconButton } from '@/components/ui/Button';
import { Badge, Callout, ProgressBar } from '@/components/ui/Feedback';
import { NumberField, Select } from '@/components/ui/Form';
import { Section } from '@/components/ui/Overlay';
import { useConfigStore } from '@/stores/configStore';
import { EMPTY_CLUSTERINGS, useActiveDataset, useDatasetStore } from '@/stores/datasetStore';
import { useActiveExperiment, useExperimentStore } from '@/stores/experimentStore';
import { useViewStore } from '@/stores/viewStore';
import { runClustering } from '@/services/experiments/runner';
import { HIERARCHICAL_LIMIT } from '@/algorithms/clustering/hierarchical';
import type { ClusteringMethod } from '@/types/experiment';
import { errorMessage } from '@/utils/misc';

export function ClusteringSection() {
  const dataset = useActiveDataset();
  const experiment = useActiveExperiment();
  const clusterings = useDatasetStore((s) =>
    dataset ? (s.clusterings[dataset.id] ?? EMPTY_CLUSTERINGS) : EMPTY_CLUSTERINGS,
  );
  const job = useExperimentStore((s) => s.jobs.clustering);
  const preprocessing = useConfigStore((s) => s.preprocessing);
  const [method, setMethod] = useState<ClusteringMethod>('kmeans');
  const [space, setSpace] = useState<'original' | 'projection'>('original');
  const [k, setK] = useState(5);
  const [eps, setEps] = useState(0.5);
  const [minSamples, setMinSamples] = useState(5);
  const [linkage, setLinkage] = useState('ward');
  const [seed, setSeed] = useState(0);
  const [error, setError] = useState<string | null>(null);

  if (!dataset) return null;
  const projectionAvailable = experiment?.datasetId === dataset.id;
  const rows =
    space === 'projection' && experiment ? experiment.coords.length / experiment.outputDims : dataset.n;
  const tooLarge = method === 'hierarchical' && rows > HIERARCHICAL_LIMIT;

  const run = async () => {
    setError(null);
    const params: Record<string, number | string> =
      method === 'kmeans' ? { k, nInit: 4 } : method === 'dbscan' ? { eps, minSamples } : { k, linkage };
    try {
      const result = await runClustering(dataset, method, params, space, experiment, preprocessing, seed);
      if (result) useViewStore.getState().setColorBy({ type: 'clustering', id: result.id });
    } catch (e) {
      setError(errorMessage(e));
    }
  };

  return (
    <Section title="Clustering" icon={<Boxes />} defaultOpen={false}>
      <p className="text-xs leading-relaxed text-subtle">
        Computed clusters are stored separately from the dataset and never overwrite ground-truth or imported
        labels.
      </p>
      <div className="grid grid-cols-2 gap-2.5">
        <Select
          label="Method"
          value={method}
          onChange={(v) => setMethod(v as ClusteringMethod)}
          options={[
            { value: 'kmeans', label: 'k-means' },
            { value: 'dbscan', label: 'DBSCAN' },
            { value: 'hierarchical', label: 'Hierarchical' },
          ]}
        />
        <Select
          label="Space"
          value={space}
          onChange={(v) => setSpace(v as 'original' | 'projection')}
          hint="Original = the preprocessed feature space. Projection = the current 2D/3D coordinates (clusters there reflect the projection's distortions)."
          options={[
            { value: 'original', label: 'Original features' },
            { value: 'projection', label: 'Projection', disabled: !projectionAvailable },
          ]}
        />
        {method !== 'dbscan' && (
          <NumberField
            label="Clusters (k)"
            value={k}
            integer
            min={1}
            max={100}
            onChange={(v) => setK(v ?? 2)}
          />
        )}
        {method === 'dbscan' && (
          <>
            <NumberField
              label="ε (radius)"
              value={eps}
              min={0.0001}
              step={0.1}
              hint="Neighbourhood radius in the chosen space's units."
              onChange={(v) => setEps(v ?? 0.5)}
            />
            <NumberField
              label="Min samples"
              value={minSamples}
              integer
              min={1}
              onChange={(v) => setMinSamples(v ?? 5)}
            />
          </>
        )}
        {method === 'hierarchical' && (
          <Select
            label="Linkage"
            value={linkage}
            onChange={setLinkage}
            options={[
              { value: 'ward', label: 'Ward' },
              { value: 'average', label: 'Average' },
              { value: 'complete', label: 'Complete' },
              { value: 'single', label: 'Single' },
            ]}
          />
        )}
        {method === 'kmeans' && (
          <NumberField label="Seed" value={seed} integer onChange={(v) => setSeed(v ?? 0)} />
        )}
      </div>
      {tooLarge && (
        <Callout tone="warning">
          Hierarchical clustering is limited to {HIERARCHICAL_LIMIT.toLocaleString()} observations (O(N²)
          memory). Use k-means, or cluster a subsampled projection.
        </Callout>
      )}
      {job ? (
        <div className="space-y-2">
          <ProgressBar value={job.progress?.fraction ?? null} label="Clustering progress" />
          <Button size="sm" variant="danger" className="w-full" onClick={job.cancel}>
            Cancel
          </Button>
        </div>
      ) : (
        <Button
          size="sm"
          variant="secondary"
          className="w-full"
          disabled={tooLarge}
          onClick={() => void run()}
        >
          Compute clusters
        </Button>
      )}
      {error && <Callout tone="danger">{error}</Callout>}
      {clusterings.length > 0 && (
        <ul className="space-y-1.5">
          {clusterings.map((c, i) => (
            <li
              key={c.id}
              className="flex items-start gap-2 rounded-md border border-line bg-surface/60 p-2 text-xs"
            >
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-1.5">
                  <span className="font-medium text-fg">Computed #{i + 1}</span>
                  <Badge tone="violet">{c.space}</Badge>
                </div>
                <p className="mt-0.5 leading-snug text-subtle">{c.summary}</p>
                <button
                  type="button"
                  className="mt-1 text-accent hover:underline"
                  onClick={() => useViewStore.getState().setColorBy({ type: 'clustering', id: c.id })}
                >
                  Colour by these clusters
                </button>
              </div>
              <IconButton
                size="sm"
                label="Delete clustering"
                icon={<Trash2 />}
                onClick={() => useDatasetStore.getState().removeClustering(dataset.id, c.id)}
              />
            </li>
          ))}
        </ul>
      )}
    </Section>
  );
}
