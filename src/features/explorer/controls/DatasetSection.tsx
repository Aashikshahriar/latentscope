import { Copy, Database, HardDrive, RefreshCw, Upload } from 'lucide-react';
import { useState } from 'react';
import { Link } from 'react-router';
import { Button } from '@/components/ui/Button';
import { Badge, Callout } from '@/components/ui/Feedback';
import { NumberField, Select, type SelectOption } from '@/components/ui/Form';
import { Section } from '@/components/ui/Overlay';
import { DEMOS, demoDatasetId } from '@/services/datasets/demos';
import { useActiveDataset, useDatasetStore } from '@/stores/datasetStore';
import { useUiStore } from '@/stores/uiStore';
import type { GaussianClustersSpec, SwissRollSpec } from '@/types/dataset';
import { formatBytes, formatInteger, shortHash } from '@/utils/format';
import { errorMessage } from '@/utils/misc';

export function DatasetSection() {
  const dataset = useActiveDataset();
  const datasets = useDatasetStore((s) => s.datasets);
  const library = useDatasetStore((s) => s.library);
  const savedIds = useDatasetStore((s) => s.savedIds);
  const loading = useDatasetStore((s) => s.loading);
  const setImportOpen = useUiStore((s) => s.setImportOpen);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  const loadedOptions: SelectOption<string>[] = Object.values(datasets).map((d) => ({
    value: `loaded:${d.id}`,
    label: d.name,
    description: `${d.n} × ${d.d} · in memory`,
  }));
  const demoOptions: SelectOption<string>[] = DEMOS.filter(
    (d) => !datasets[demoDatasetId(d.defaultSpec)],
  ).map((d) => ({
    value: `demo:${d.key}`,
    label: d.title,
    description: `Demo · ${d.size}${d.synthetic ? ' · synthetic' : ''}`,
  }));
  const libraryOptions: SelectOption<string>[] = library
    .filter((l) => !datasets[l.id])
    .map((l) => ({ value: `lib:${l.id}`, label: l.name, description: `${l.n} × ${l.d} · saved locally` }));

  const onSelect = async (value: string) => {
    setError(null);
    const [kind, ...rest] = value.split(':');
    const id = rest.join(':');
    try {
      if (kind === 'loaded') useDatasetStore.getState().setActive(id);
      else if (kind === 'lib') await useDatasetStore.getState().openFromLibrary(id);
      else if (kind === 'demo')
        await useDatasetStore.getState().loadDemo(DEMOS.find((d) => d.key === id)!.defaultSpec);
    } catch (e) {
      setError(errorMessage(e));
    }
  };

  const isSaved = dataset ? savedIds.includes(dataset.id) : false;
  const spec = dataset?.source.type === 'demo' ? dataset.source.spec : null;

  return (
    <Section title="Dataset" icon={<Database />}>
      <Select
        label="Active dataset"
        ariaLabel="Active dataset"
        value={dataset ? `loaded:${dataset.id}` : undefined}
        onChange={(v) => void onSelect(v)}
        placeholder={loading ?? 'Choose a dataset…'}
        options={[...loadedOptions, ...demoOptions, ...libraryOptions]}
      />
      <div className="flex gap-2">
        <Button
          size="sm"
          variant="secondary"
          icon={<Upload className="size-3.5" />}
          onClick={() => setImportOpen(true)}
          className="flex-1"
        >
          Import
        </Button>
        {dataset && dataset.source.type !== 'demo' && (
          <Button
            size="sm"
            variant="secondary"
            icon={<HardDrive className="size-3.5" />}
            disabled={isSaved}
            onClick={() =>
              void useDatasetStore
                .getState()
                .saveToLibrary(dataset.id)
                .catch((e) => setError(errorMessage(e)))
            }
            className="flex-1"
          >
            {isSaved ? 'Saved' : 'Save locally'}
          </Button>
        )}
        <Link to="/datasets" className="flex-1">
          <Button size="sm" variant="ghost" className="w-full">
            Manage
          </Button>
        </Link>
      </div>
      {error && <Callout tone="danger">{error}</Callout>}
      {dataset && (
        <div className="space-y-2 rounded-lg border border-line bg-surface/70 p-3 text-xs">
          <div className="flex flex-wrap items-center gap-1.5">
            <span className="num font-semibold text-fg">
              {formatInteger(dataset.n)} × {formatInteger(dataset.d)}
            </span>
            <span className="text-subtle">observations × features</span>
            {dataset.provenance?.synthetic && <Badge tone="violet">synthetic</Badge>}
            {dataset.source.type === 'upload' && <Badge tone="teal">local file</Badge>}
          </div>
          <div className="flex items-center justify-between gap-2 text-subtle">
            <span>
              {dataset.columns.length} metadata column{dataset.columns.length === 1 ? '' : 's'} ·{' '}
              {formatBytes(dataset.values.byteLength)}
            </span>
            <button
              type="button"
              className="num inline-flex items-center gap-1 rounded px-1 text-2xs hover:text-fg"
              title={`SHA-256 ${dataset.checksum}`}
              aria-label="Copy dataset checksum"
              onClick={() => {
                void navigator.clipboard?.writeText(dataset.checksum).then(() => {
                  setCopied(true);
                  setTimeout(() => setCopied(false), 1200);
                });
              }}
            >
              <Copy className="size-3" aria-hidden />
              {copied ? 'copied' : shortHash(dataset.checksum)}
            </button>
          </div>
          {dataset.provenance && (
            <details className="group text-subtle">
              <summary className="cursor-pointer select-none hover:text-fg">Source & licence</summary>
              <div className="mt-1.5 space-y-1 leading-relaxed">
                <p>{dataset.provenance.source}</p>
                <p>
                  <span className="text-muted">Licence:</span> {dataset.provenance.license}
                </p>
                <p>
                  <span className="text-muted">Features:</span> {dataset.provenance.featureDescription}
                </p>
              </div>
            </details>
          )}
          {dataset.importNotes.length > 0 && (
            <details className="text-subtle">
              <summary className="cursor-pointer select-none hover:text-fg">
                Import notes ({dataset.importNotes.length})
              </summary>
              <ul className="mt-1.5 list-disc space-y-1 pl-4">
                {dataset.importNotes.map((n) => (
                  <li key={n}>{n}</li>
                ))}
              </ul>
            </details>
          )}
        </div>
      )}
      {spec?.kind === 'gaussian-clusters' && <GaussianEditor spec={spec} />}
      {spec?.kind === 'swiss-roll' && <SwissRollEditor spec={spec} />}
    </Section>
  );
}

function GaussianEditor({ spec }: { spec: GaussianClustersSpec }) {
  const [draft, setDraft] = useState(spec);
  const [error, setError] = useState<string | null>(null);
  const changed = JSON.stringify(draft) !== JSON.stringify(spec);
  return (
    <div className="space-y-3 rounded-lg border border-dashed border-line p-3">
      <p className="text-xs font-medium text-muted">Generator parameters</p>
      <div className="grid grid-cols-2 gap-2.5">
        <NumberField
          label="Clusters"
          value={draft.clusters}
          integer
          min={1}
          max={30}
          onChange={(v) => setDraft({ ...draft, clusters: v ?? 1 })}
        />
        <NumberField
          label="Dimensions"
          value={draft.dimensions}
          integer
          min={2}
          max={512}
          onChange={(v) => setDraft({ ...draft, dimensions: v ?? 2 })}
        />
        <NumberField
          label="Points / cluster"
          value={draft.pointsPerCluster}
          integer
          min={2}
          max={5000}
          onChange={(v) => setDraft({ ...draft, pointsPerCluster: v ?? 2 })}
        />
        <NumberField
          label="Separation"
          value={draft.separation}
          min={0}
          max={100}
          step={0.5}
          hint="Expected distance between cluster centres, in units of the noise standard deviation."
          onChange={(v) => setDraft({ ...draft, separation: v ?? 0 })}
        />
        <NumberField
          label="Noise σ"
          value={draft.noise}
          min={0.01}
          max={20}
          step={0.1}
          onChange={(v) => setDraft({ ...draft, noise: v ?? 1 })}
        />
        <NumberField
          label="Seed"
          value={draft.seed}
          integer
          onChange={(v) => setDraft({ ...draft, seed: v ?? 0 })}
        />
      </div>
      {error && <Callout tone="danger">{error}</Callout>}
      <Button
        size="sm"
        variant={changed ? 'primary' : 'secondary'}
        icon={<RefreshCw className="size-3.5" />}
        disabled={!changed}
        className="w-full"
        onClick={() => {
          setError(null);
          void useDatasetStore
            .getState()
            .loadDemo(draft)
            .catch((e) => setError(errorMessage(e)));
        }}
      >
        Generate dataset
      </Button>
    </div>
  );
}

function SwissRollEditor({ spec }: { spec: SwissRollSpec }) {
  const [draft, setDraft] = useState(spec);
  const changed = JSON.stringify(draft) !== JSON.stringify(spec);
  return (
    <div className="space-y-3 rounded-lg border border-dashed border-line p-3">
      <p className="text-xs font-medium text-muted">Generator parameters</p>
      <div className="grid grid-cols-3 gap-2.5">
        <NumberField
          label="Points"
          value={draft.points}
          integer
          min={50}
          max={20000}
          onChange={(v) => setDraft({ ...draft, points: v ?? 1500 })}
        />
        <NumberField
          label="Noise"
          value={draft.noise}
          min={0}
          max={5}
          step={0.1}
          onChange={(v) => setDraft({ ...draft, noise: v ?? 0 })}
        />
        <NumberField
          label="Seed"
          value={draft.seed}
          integer
          onChange={(v) => setDraft({ ...draft, seed: v ?? 0 })}
        />
      </div>
      <Button
        size="sm"
        variant={changed ? 'primary' : 'secondary'}
        icon={<RefreshCw className="size-3.5" />}
        disabled={!changed}
        className="w-full"
        onClick={() => void useDatasetStore.getState().loadDemo(draft)}
      >
        Generate dataset
      </Button>
    </div>
  );
}
