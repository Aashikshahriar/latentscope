import { Database, FolderOpen, HardDrive, Pencil, ShieldCheck, Trash2, Upload, X } from 'lucide-react';
import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router';
import { Button, IconButton } from '@/components/ui/Button';
import { Badge, Callout, EmptyState } from '@/components/ui/Feedback';
import { TextInput } from '@/components/ui/Form';
import { DEMOS, demoDatasetId } from '@/services/datasets/demos';
import { clearAllLocalData, persistenceAvailable, storageEstimate } from '@/services/persistence/db';
import { useDatasetStore } from '@/stores/datasetStore';
import { useExperimentStore } from '@/stores/experimentStore';
import { useUiStore } from '@/stores/uiStore';
import { log } from '@/stores/logStore';
import { formatBytes, formatDate, formatInteger, shortHash } from '@/utils/format';
import { errorMessage } from '@/utils/misc';
import { ImportWizard } from './ImportWizard';

export default function DatasetsPage() {
  const datasets = useDatasetStore((s) => s.datasets);
  const library = useDatasetStore((s) => s.library);
  const savedIds = useDatasetStore((s) => s.savedIds);
  const activeId = useDatasetStore((s) => s.activeId);
  const importOpen = useUiStore((s) => s.importOpen);
  const setImportOpen = useUiStore((s) => s.setImportOpen);
  const navigate = useNavigate();
  const [usage, setUsage] = useState<{ usage: number; quota: number } | null>(null);
  const [editing, setEditing] = useState<string | null>(null);
  const [draft, setDraft] = useState('');
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    void useDatasetStore.getState().refreshLibrary();
    void storageEstimate().then(setUsage);
  }, [library.length]);

  const open = async (id: string, fromLibrary: boolean) => {
    setError(null);
    try {
      if (fromLibrary) await useDatasetStore.getState().openFromLibrary(id);
      else useDatasetStore.getState().setActive(id);
      navigate('/explore');
    } catch (e) {
      setError(errorMessage(e));
    }
  };

  const loadDemo = async (key: string) => {
    setError(null);
    try {
      await useDatasetStore.getState().loadDemo(DEMOS.find((d) => d.key === key)!.defaultSpec);
      navigate('/explore');
    } catch (e) {
      setError(errorMessage(e));
    }
  };

  const clearAll = async () => {
    if (
      !window.confirm(
        'Delete all locally stored datasets, experiments and clusterings from this browser? This cannot be undone.',
      )
    )
      return;
    await clearAllLocalData();
    useExperimentStore.setState({ experiments: [], activeId: null });
    await useDatasetStore.getState().refreshLibrary();
    setUsage(await storageEstimate());
    log('info', 'Cleared all local LatentScope data from IndexedDB.');
  };

  const inMemory = Object.values(datasets);

  return (
    <div className="scroll-thin h-full overflow-y-auto">
      <div className="mx-auto max-w-6xl space-y-8 p-4 sm:p-6">
        <div className="flex flex-wrap items-end gap-4">
          <div className="mr-auto">
            <h1 className="flex items-center gap-2 text-lg font-semibold">
              <Database className="size-5 text-accent" aria-hidden /> Datasets
            </h1>
            <p className="mt-1 text-sm text-muted">
              Import your own embeddings, manage what is stored in this browser, or start from a documented
              demonstration dataset.
            </p>
          </div>
          <Button variant="primary" icon={<Upload className="size-4" />} onClick={() => setImportOpen(true)}>
            Import embeddings
          </Button>
        </div>

        <Callout tone="success" title="Privacy">
          <span className="flex gap-1.5">
            <ShieldCheck className="mt-0.5 size-3.5 shrink-0" aria-hidden />
            Files are parsed and analysed locally. LatentScope has no backend and sends no analytics. Saved
            datasets live in this browser’s IndexedDB and are removed when you delete them here or clear site
            data.
          </span>
        </Callout>
        {error && <Callout tone="danger">{error}</Callout>}

        <section aria-labelledby="library">
          <div className="mb-3 flex flex-wrap items-center gap-3">
            <h2 id="library" className="flex items-center gap-2 text-sm font-semibold">
              <HardDrive className="size-4 text-subtle" aria-hidden /> Saved in this browser
            </h2>
            {usage && (
              <span className="num text-xs text-subtle">
                {formatBytes(usage.usage)} used of ~{formatBytes(usage.quota)} available to this site
              </span>
            )}
            {persistenceAvailable() && library.length > 0 && (
              <Button
                size="xs"
                variant="danger"
                className="ml-auto"
                icon={<Trash2 className="size-3" />}
                onClick={() => void clearAll()}
              >
                Clear all local data
              </Button>
            )}
          </div>
          {!persistenceAvailable() ? (
            <Callout tone="warning">
              IndexedDB is unavailable (for example in some private-browsing modes); datasets cannot be saved
              between visits.
            </Callout>
          ) : library.length === 0 ? (
            <EmptyState title="No saved datasets" icon={<HardDrive />}>
              Imported datasets can be saved locally from the import wizard or the Explorer.
            </EmptyState>
          ) : (
            <div className="scroll-thin overflow-x-auto rounded-xl border border-line">
              <table className="w-full min-w-[720px] text-sm">
                <thead className="bg-surface text-left text-2xs text-subtle uppercase">
                  <tr>
                    <th className="px-4 py-2 font-medium">Name</th>
                    <th className="px-4 py-2 font-medium">Shape</th>
                    <th className="px-4 py-2 font-medium">Size</th>
                    <th className="px-4 py-2 font-medium">Checksum</th>
                    <th className="px-4 py-2 font-medium">Saved</th>
                    <th className="px-4 py-2 text-right font-medium">Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {library.map((d) => (
                    <tr key={d.id} className="border-t border-line">
                      <td className="px-4 py-2">
                        {editing === d.id ? (
                          <form
                            onSubmit={(e) => {
                              e.preventDefault();
                              void useDatasetStore.getState().renameDataset(d.id, draft);
                              setEditing(null);
                            }}
                          >
                            <TextInput
                              autoFocus
                              value={draft}
                              onChange={(e) => setDraft(e.target.value)}
                              onBlur={() => setEditing(null)}
                              aria-label="Dataset name"
                            />
                          </form>
                        ) : (
                          <span className="font-medium text-fg">{d.name}</span>
                        )}
                        {d.id === activeId && (
                          <Badge tone="accent" className="ml-2">
                            active
                          </Badge>
                        )}
                      </td>
                      <td className="num px-4 py-2 text-muted">
                        {formatInteger(d.n)} × {formatInteger(d.d)}
                      </td>
                      <td className="num px-4 py-2 text-muted">{formatBytes(d.sizeBytes)}</td>
                      <td className="num px-4 py-2 text-subtle" title={d.checksum}>
                        {shortHash(d.checksum, 12)}
                      </td>
                      <td className="px-4 py-2 text-subtle">{formatDate(d.createdAt)}</td>
                      <td className="px-4 py-2">
                        <div className="flex justify-end gap-0.5">
                          <IconButton
                            size="sm"
                            label="Open in Explorer"
                            icon={<FolderOpen />}
                            onClick={() => void open(d.id, true)}
                          />
                          <IconButton
                            size="sm"
                            label="Rename"
                            icon={<Pencil />}
                            onClick={() => {
                              setEditing(d.id);
                              setDraft(d.name);
                            }}
                          />
                          <IconButton
                            size="sm"
                            label="Delete from local storage"
                            icon={<Trash2 />}
                            onClick={() => {
                              if (
                                window.confirm(
                                  `Delete “${d.name}” from this browser? Experiments that used it are kept but cannot be reopened until the file is imported again.`,
                                )
                              ) {
                                void useDatasetStore.getState().deleteFromLibrary(d.id);
                              }
                            }}
                          />
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </section>

        {inMemory.length > 0 && (
          <section aria-labelledby="memory">
            <h2 id="memory" className="mb-3 text-sm font-semibold">
              Loaded in this session
            </h2>
            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
              {inMemory.map((d) => (
                <div key={d.id} className="flex flex-col rounded-xl border border-line bg-card p-4">
                  <div className="flex items-start gap-2">
                    <p className="mr-auto font-medium text-fg">{d.name}</p>
                    <IconButton
                      size="sm"
                      label="Unload from memory"
                      icon={<X />}
                      onClick={() => useDatasetStore.getState().unload(d.id)}
                    />
                  </div>
                  <p className="num mt-1 text-xs text-muted">
                    {formatInteger(d.n)} × {formatInteger(d.d)} · {formatBytes(d.values.byteLength)}
                  </p>
                  <div className="mt-2 flex flex-wrap gap-1">
                    {d.source.type === 'demo' && <Badge tone="violet">demo</Badge>}
                    {d.provenance?.synthetic && <Badge tone="violet">synthetic</Badge>}
                    {savedIds.includes(d.id) && <Badge tone="success">saved</Badge>}
                    {d.id === activeId && <Badge tone="accent">active</Badge>}
                  </div>
                  <div className="mt-auto flex gap-2 pt-3">
                    <Button size="xs" variant="secondary" onClick={() => void open(d.id, false)}>
                      Explore
                    </Button>
                    {d.source.type !== 'demo' && !savedIds.includes(d.id) && (
                      <Button
                        size="xs"
                        variant="ghost"
                        onClick={() =>
                          void useDatasetStore
                            .getState()
                            .saveToLibrary(d.id)
                            .catch((e) => setError(errorMessage(e)))
                        }
                      >
                        Save locally
                      </Button>
                    )}
                  </div>
                </div>
              ))}
            </div>
          </section>
        )}

        <section aria-labelledby="demos">
          <h2 id="demos" className="mb-1 text-sm font-semibold">
            Demonstration datasets
          </h2>
          <p className="mb-3 text-xs text-muted">
            Source, licence, feature definitions and preprocessing are listed for each; synthetic data is
            labelled as such.
          </p>
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            {DEMOS.map((demo) => {
              const loaded = datasets[demoDatasetId(demo.defaultSpec)];
              return (
                <article key={demo.key} className="flex flex-col rounded-xl border border-line bg-card p-4">
                  <h3 className="font-medium text-fg">{demo.title}</h3>
                  <p className="num mt-0.5 text-2xs text-subtle">{demo.size}</p>
                  <div className="mt-2 flex flex-wrap gap-1">
                    {demo.tags.map((t) => (
                      <Badge
                        key={t}
                        tone={t === 'synthetic' ? 'violet' : t === 'pretrained' ? 'teal' : 'neutral'}
                      >
                        {t}
                      </Badge>
                    ))}
                  </div>
                  <p className="mt-2 text-xs leading-relaxed text-muted">{demo.summary}</p>
                  {loaded?.provenance && (
                    <details className="mt-2 text-2xs text-subtle">
                      <summary className="cursor-pointer select-none hover:text-fg">Provenance</summary>
                      <p className="mt-1">{loaded.provenance.source}</p>
                      <p className="mt-1">Licence: {loaded.provenance.license}</p>
                      {loaded.provenance.citation && (
                        <p className="mt-1">Cite: {loaded.provenance.citation}</p>
                      )}
                    </details>
                  )}
                  <Button
                    size="xs"
                    variant={loaded ? 'secondary' : 'primary'}
                    className="mt-auto self-start"
                    onClick={() => void loadDemo(demo.key)}
                  >
                    {loaded ? 'Explore' : 'Load'}
                  </Button>
                </article>
              );
            })}
          </div>
        </section>
      </div>
      <ImportWizard
        open={importOpen}
        onOpenChange={(v) => {
          setImportOpen(v);
          if (!v && useDatasetStore.getState().activeId !== activeId) navigate('/explore');
        }}
      />
    </div>
  );
}
