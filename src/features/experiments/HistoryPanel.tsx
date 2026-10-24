import { Copy, FolderOpen, GitCompareArrows, History, Pencil, Trash2 } from 'lucide-react';
import { useState } from 'react';
import { useNavigate } from 'react-router';
import { Button, IconButton } from '@/components/ui/Button';
import { Badge, Callout, EmptyState } from '@/components/ui/Feedback';
import { TextInput } from '@/components/ui/Form';
import type { Experiment } from '@/types/experiment';
import { useDatasetStore } from '@/stores/datasetStore';
import { useExperimentStore } from '@/stores/experimentStore';
import { ALGORITHM_LABELS } from '@/services/experiments/runner';
import { paramsSummary, preprocessingSummary } from '@/services/experiments/describe';
import { formatDate, formatDuration, formatNumber, shortHash } from '@/utils/format';
import { errorMessage } from '@/utils/misc';
import { openExperiment } from '@/services/experiments/open';
import { duplicateConfiguration } from '@/services/experiments/duplicate';

export function HistoryPanel({ datasetId }: { datasetId: string | null }) {
  const experiments = useExperimentStore((s) => s.experiments);
  const activeId = useExperimentStore((s) => s.activeId);
  const datasets = useDatasetStore((s) => s.datasets);
  const [filter, setFilter] = useState<'dataset' | 'all'>('dataset');
  const [editing, setEditing] = useState<string | null>(null);
  const [draft, setDraft] = useState('');
  const [compare, setCompare] = useState<string[]>([]);
  const [error, setError] = useState<string | null>(null);
  const navigate = useNavigate();

  const shown =
    filter === 'dataset' && datasetId ? experiments.filter((e) => e.datasetId === datasetId) : experiments;
  if (experiments.length === 0) {
    return (
      <EmptyState title="No experiments yet" icon={<History />}>
        Every projection you run is recorded here with its full configuration, and saved in this browser.
      </EmptyState>
    );
  }

  const open = async (e: Experiment) => {
    setError(null);
    try {
      await openExperiment(e);
    } catch (err) {
      setError(errorMessage(err));
    }
  };

  const compareDataset = compare.length ? experiments.find((e) => e.id === compare[0])?.datasetId : null;

  return (
    <div className="space-y-3 p-4">
      <div className="flex flex-wrap items-center gap-2">
        <div className="flex rounded-lg border border-line p-0.5 text-xs">
          {(['dataset', 'all'] as const).map((f) => (
            <button
              key={f}
              type="button"
              aria-pressed={filter === f}
              onClick={() => setFilter(f)}
              className={`rounded-md px-2.5 py-1 ${filter === f ? 'bg-elevated text-fg' : 'text-muted hover:text-fg'}`}
            >
              {f === 'dataset' ? 'This dataset' : 'All datasets'}
            </button>
          ))}
        </div>
        <span className="text-xs text-subtle">
          {shown.length} experiment(s), stored locally in this browser
        </span>
        <Button
          size="sm"
          variant="secondary"
          className="ml-auto"
          icon={<GitCompareArrows className="size-3.5" />}
          disabled={compare.length < 2}
          onClick={() => navigate(`/compare?experiments=${compare.join(',')}`)}
        >
          Compare selected ({compare.length})
        </Button>
      </div>
      {error && <Callout tone="danger">{error}</Callout>}
      <div className="scroll-thin overflow-x-auto rounded-lg border border-line">
        <table className="w-full min-w-[860px] text-xs">
          <thead className="bg-surface text-left text-2xs text-subtle uppercase">
            <tr>
              <th className="w-8 px-2 py-2" aria-label="Compare" />
              <th className="px-2 py-2 font-medium">Experiment</th>
              <th className="px-2 py-2 font-medium">Configuration</th>
              <th className="px-2 py-2 text-right font-medium">Trust.</th>
              <th className="px-2 py-2 text-right font-medium">NP</th>
              <th className="px-2 py-2 text-right font-medium">Runtime</th>
              <th className="px-2 py-2 font-medium">Created</th>
              <th className="px-2 py-2 text-right font-medium">Actions</th>
            </tr>
          </thead>
          <tbody>
            {shown.map((e) => (
              <tr
                key={e.id}
                className={`border-t border-line align-top ${e.id === activeId ? 'bg-accent/[0.06]' : ''}`}
              >
                <td className="px-2 py-2">
                  <input
                    type="checkbox"
                    aria-label={`Select ${e.name} for comparison`}
                    checked={compare.includes(e.id)}
                    disabled={
                      !compare.includes(e.id) &&
                      (compare.length >= 3 ||
                        (compareDataset !== null &&
                          compareDataset !== undefined &&
                          compareDataset !== e.datasetId))
                    }
                    onChange={(ev) =>
                      setCompare((c) => (ev.target.checked ? [...c, e.id] : c.filter((x) => x !== e.id)))
                    }
                    className="accent-[var(--color-accent)]"
                  />
                </td>
                <td className="max-w-[16rem] px-2 py-2">
                  {editing === e.id ? (
                    <form
                      onSubmit={(ev) => {
                        ev.preventDefault();
                        useExperimentStore.getState().rename(e.id, draft);
                        setEditing(null);
                      }}
                    >
                      <TextInput
                        autoFocus
                        value={draft}
                        onChange={(ev) => setDraft(ev.target.value)}
                        onBlur={() => setEditing(null)}
                        aria-label="Experiment name"
                      />
                    </form>
                  ) : (
                    <>
                      <p className="truncate font-medium text-fg" title={e.name}>
                        {e.name}
                      </p>
                      <p className="truncate text-2xs text-subtle">
                        {e.datasetName} · <span className="num">{shortHash(e.datasetChecksum, 8)}</span>
                        {!datasets[e.datasetId] && ' · dataset not loaded'}
                      </p>
                    </>
                  )}
                </td>
                <td className="px-2 py-2">
                  <div className="flex flex-wrap items-center gap-1">
                    <Badge tone="accent">{ALGORITHM_LABELS[e.algorithm]}</Badge>
                    <Badge>{e.outputDims}D</Badge>
                    {e.rowIndices && <Badge tone="warning">n = {e.rowIndices.length}</Badge>}
                  </div>
                  <p className="num mt-1 text-2xs text-subtle">{paramsSummary(e.params)}</p>
                  <p className="text-2xs text-subtle">
                    preprocessing: {preprocessingSummary(e.preprocessing)}
                  </p>
                </td>
                <td className="num px-2 py-2 text-right">
                  {formatNumber(e.metrics?.trustworthiness?.value, 3)}
                </td>
                <td className="num px-2 py-2 text-right">
                  {formatNumber(e.metrics?.neighborhoodPreservation?.value, 3)}
                </td>
                <td className="num px-2 py-2 text-right">{formatDuration(e.runtimeMs)}</td>
                <td className="px-2 py-2 whitespace-nowrap text-subtle">{formatDate(e.createdAt)}</td>
                <td className="px-2 py-2">
                  <div className="flex justify-end gap-0.5">
                    <IconButton size="sm" label="Open" icon={<FolderOpen />} onClick={() => void open(e)} />
                    <IconButton
                      size="sm"
                      label="Rename"
                      icon={<Pencil />}
                      onClick={() => {
                        setEditing(e.id);
                        setDraft(e.name);
                      }}
                    />
                    <IconButton
                      size="sm"
                      label="Duplicate configuration into the controls"
                      icon={<Copy />}
                      onClick={() => duplicateConfiguration(e)}
                    />
                    <IconButton
                      size="sm"
                      label="Delete"
                      icon={<Trash2 />}
                      onClick={() => {
                        if (window.confirm(`Delete experiment “${e.name}”? This cannot be undone.`))
                          useExperimentStore.getState().remove(e.id);
                      }}
                    />
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
