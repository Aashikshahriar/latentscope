import { Check, FileUp, ShieldCheck } from 'lucide-react';
import { useMemo, useRef, useState } from 'react';
import { Button } from '@/components/ui/Button';
import { Badge, Callout, Spinner } from '@/components/ui/Feedback';
import { Checkbox, Select, Switch, TextInput } from '@/components/ui/Form';
import { Dialog } from '@/components/ui/Overlay';
import { extractImport, openImport, SUPPORTED_EXTENSIONS, type ImportSession } from '@/services/import';
import { describeShape, embeddingCandidate } from '@/services/import/arrays';
import {
  estimateMemoryBytes,
  finalizeDataset,
  memoryBudgetBytes,
  validateExtracted,
  type IdStrategy,
} from '@/services/import/finalize';
import type {
  ArrayMapping,
  ColumnAssignment,
  ExtractedData,
  TableMapping,
  TablePreview,
  ArrayPreview,
} from '@/services/import/types';
import type { MissingValuePolicy } from '@/types/algorithms';
import type { ColumnKind, ColumnRole } from '@/types/dataset';
import { useDatasetStore } from '@/stores/datasetStore';
import { log } from '@/stores/logStore';
import { formatBytes, formatInteger } from '@/utils/format';
import { cn, errorMessage } from '@/utils/misc';

const STEPS = ['Upload', 'Preview', 'Features', 'Metadata', 'Validate', 'Confirm'] as const;

const ROLE_OPTIONS: { value: ColumnAssignment; label: string }[] = [
  { value: 'ignore', label: 'Ignore' },
  { value: 'id', label: 'Observation ID' },
  { value: 'label', label: 'Class label (ground truth)' },
  { value: 'cluster', label: 'Cluster label (imported)' },
  { value: 'sample-name', label: 'Sample name' },
  { value: 'source-model', label: 'Source model' },
  { value: 'modality', label: 'Modality' },
  { value: 'image-url', label: 'Image URL' },
  { value: 'text', label: 'Text description' },
  { value: 'custom', label: 'Other metadata' },
];

function initialTableMapping(preview: TablePreview): TableMapping {
  const assignments: Record<string, ColumnAssignment> = {};
  const kinds: Record<string, ColumnKind> = {};
  let idTaken = false;
  for (const c of preview.inferred) {
    let role = c.suggestedRole;
    if (role === 'id') {
      if (idTaken) role = 'custom';
      idTaken = true;
    }
    assignments[c.name] = role;
    kinds[c.name] = c.suggestedKind;
  }
  return { hasHeader: preview.hasHeader, assignments, kinds };
}

function initialArrayMapping(preview: ArrayPreview, chosen?: string): ArrayMapping {
  const embedding =
    chosen ??
    preview.arrays.find((a) => a.array && embeddingCandidate(a.array, false).ok)?.name ??
    preview.arrays[0]?.name ??
    '';
  const metadata: ArrayMapping['metadata'] = {};
  const n = preview.arrays.find((a) => a.name === embedding)?.array?.shape[0];
  for (const a of preview.arrays) {
    if (a.name === embedding || !a.array || a.array.shape.length !== 1 || a.array.shape[0] !== n) continue;
    const lower = a.name.toLowerCase();
    metadata[a.name] = /^(ids?|index|keys?)$/.test(lower)
      ? 'id'
      : /label|class|target|^y$/.test(lower)
        ? 'label'
        : /cluster/.test(lower)
          ? 'cluster'
          : 'custom';
  }
  return { embedding, flattenTrailing: false, metadata };
}

export function ImportWizard({ open, onOpenChange }: { open: boolean; onOpenChange: (v: boolean) => void }) {
  const [step, setStep] = useState(0);
  const [session, setSession] = useState<ImportSession | null>(null);
  const [tableMapping, setTableMapping] = useState<TableMapping | null>(null);
  const [arrayMapping, setArrayMapping] = useState<ArrayMapping | null>(null);
  const [extracted, setExtracted] = useState<ExtractedData | null>(null);
  const [policy, setPolicy] = useState<MissingValuePolicy>('reject');
  const [idStrategy, setIdStrategy] = useState<IdStrategy>('column');
  const [name, setName] = useState('');
  const [saveLocally, setSaveLocally] = useState(true);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [dragOver, setDragOver] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  const reset = () => {
    setStep(0);
    setSession(null);
    setTableMapping(null);
    setArrayMapping(null);
    setExtracted(null);
    setPolicy('reject');
    setIdStrategy('column');
    setName('');
    setError(null);
    setBusy(null);
  };

  const close = (v: boolean) => {
    onOpenChange(v);
    if (!v) reset();
  };

  const loadFile = async (file: File, hasHeader?: boolean) => {
    setError(null);
    setBusy('Reading file…');
    try {
      const s = await openImport(file, hasHeader);
      setSession(s);
      if (s.preview.kind === 'table') {
        setTableMapping(initialTableMapping(s.preview));
        setArrayMapping(null);
      } else {
        setArrayMapping(initialArrayMapping(s.preview));
        setTableMapping(null);
      }
      setName(file.name.replace(/\.[^.]+$/, ''));
      setExtracted(null);
      setStep(1);
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setBusy(null);
    }
  };

  const runExtraction = async () => {
    if (!session) return;
    setError(null);
    setBusy('Parsing and validating every value…');
    try {
      const data = await extractImport(session, (tableMapping ?? arrayMapping)!);
      setExtracted(data);
      setIdStrategy(data.ids ? 'column' : 'row-number');
      setStep(4);
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setBusy(null);
    }
  };

  const finish = async () => {
    if (!extracted || !session) return;
    setError(null);
    setBusy('Creating dataset…');
    try {
      const { dataset, error: err } = await finalizeDataset(extracted, {
        name,
        missingPolicy: policy,
        idStrategy,
        source: { type: 'upload', fileName: session.file.name, format: session.format },
      });
      if (!dataset) {
        setError(err);
        return;
      }
      useDatasetStore.getState().addDataset(dataset, true);
      log(
        'success',
        `Imported “${dataset.name}” (${dataset.n} × ${dataset.d}).`,
        `SHA-256 ${dataset.checksum}`,
      );
      if (saveLocally) await useDatasetStore.getState().saveToLibrary(dataset.id);
      close(false);
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setBusy(null);
    }
  };

  const validationBlocks = (() => {
    if (!extracted) return true;
    const invalid = extracted.issues.missing + extracted.issues.nonNumeric + extracted.issues.infinite;
    return validateExtracted(extracted, idStrategy).errors.length > 0 || (invalid > 0 && policy === 'reject');
  })();

  const featureCount = tableMapping
    ? Object.values(tableMapping.assignments).filter((a) => a === 'feature').length
    : null;
  const canNext =
    (step === 1 && session !== null) ||
    (step === 2 && (featureCount === null ? !!arrayMapping?.embedding : featureCount > 0)) ||
    step === 3 ||
    (step === 4 && !validationBlocks) ||
    false;

  return (
    <Dialog
      open={open}
      onOpenChange={close}
      size="xl"
      title="Import embeddings"
      description="CSV, TSV, JSON, NPY or NPZ. Files are parsed in your browser and never uploaded."
      footer={
        <>
          {busy && (
            <span className="mr-auto flex items-center gap-2 text-xs text-muted">
              <Spinner /> {busy}
            </span>
          )}
          {step > 0 && (
            <Button variant="ghost" onClick={() => setStep((s) => (s === 4 ? 3 : s - 1))} disabled={!!busy}>
              Back
            </Button>
          )}
          {step >= 1 && step <= 2 && (
            <Button variant="primary" disabled={!canNext || !!busy} onClick={() => setStep((s) => s + 1)}>
              Next
            </Button>
          )}
          {step === 3 && (
            <Button variant="primary" disabled={!!busy} onClick={() => void runExtraction()}>
              Validate data
            </Button>
          )}
          {step === 4 && (
            <Button variant="primary" disabled={!canNext || !!busy} onClick={() => setStep(5)}>
              Next
            </Button>
          )}
          {step === 5 && (
            <Button
              variant="primary"
              icon={<Check className="size-4" />}
              disabled={!!busy}
              onClick={() => void finish()}
            >
              Import dataset
            </Button>
          )}
        </>
      }
    >
      <ol className="mb-5 flex flex-wrap items-center gap-1 text-xs" aria-label="Import steps">
        {STEPS.map((s, i) => (
          <li key={s} className="flex items-center gap-1" aria-current={i === step ? 'step' : undefined}>
            <span
              className={cn(
                'grid size-5 place-items-center rounded-full text-2xs font-semibold',
                i < step
                  ? 'bg-teal/20 text-teal'
                  : i === step
                    ? 'bg-accent text-canvas'
                    : 'bg-elevated text-subtle',
              )}
            >
              {i < step ? <Check className="size-3" /> : i + 1}
            </span>
            <span className={i === step ? 'font-medium text-fg' : 'text-subtle'}>{s}</span>
            {i < STEPS.length - 1 && <span className="mx-1 h-px w-4 bg-line" aria-hidden />}
          </li>
        ))}
      </ol>

      {error && (
        <Callout tone="danger" className="mb-4">
          {error}
        </Callout>
      )}

      {step === 0 && (
        <div className="space-y-4">
          <div
            onDragOver={(e) => {
              e.preventDefault();
              setDragOver(true);
            }}
            onDragLeave={() => setDragOver(false)}
            onDrop={(e) => {
              e.preventDefault();
              setDragOver(false);
              const file = e.dataTransfer.files[0];
              if (file) void loadFile(file);
            }}
            className={cn(
              'flex flex-col items-center justify-center rounded-xl border-2 border-dashed px-6 py-12 text-center transition-colors',
              dragOver ? 'border-accent bg-accent/5' : 'border-line',
            )}
          >
            <FileUp className="mb-3 size-8 text-subtle" aria-hidden />
            <p className="text-sm font-medium text-fg">Drop a file here or choose one</p>
            <p className="mt-1 text-xs text-subtle">
              N × D matrix of embeddings, optionally with identifiers and metadata columns.
            </p>
            <Button
              className="mt-4"
              variant="primary"
              onClick={() => inputRef.current?.click()}
              disabled={!!busy}
            >
              Choose file
            </Button>
            <input
              ref={inputRef}
              type="file"
              className="sr-only"
              accept={SUPPORTED_EXTENSIONS.join(',')}
              aria-label="Choose a dataset file"
              onChange={(e) => {
                const file = e.target.files?.[0];
                if (file) void loadFile(file);
                e.target.value = '';
              }}
            />
          </div>
          <Callout tone="success" title="Your data stays on this device">
            <span className="flex items-start gap-1.5">
              <ShieldCheck className="mt-0.5 size-3.5 shrink-0" aria-hidden />
              Parsing, projection and metrics run locally in your browser. LatentScope has no server and no
              analytics; the file is never transmitted. Saving to the local library stores it in this
              browser’s IndexedDB only.
            </span>
          </Callout>
          <div className="grid gap-3 text-xs text-muted sm:grid-cols-2">
            <div>
              <p className="font-medium text-fg">CSV / TSV / JSON</p>
              <p className="mt-1 leading-relaxed">
                One row per observation. You choose which columns are features and which are identifiers,
                labels or other metadata. JSON may be an array of row objects (array fields such as
                "embedding" are expanded), or an object with "embeddings", "ids" and "labels".
              </p>
            </div>
            <div>
              <p className="font-medium text-fg">NPY / NPZ</p>
              <p className="mt-1 leading-relaxed">
                A 2-D numeric array (float/int, either byte order, C or Fortran order). In an NPZ archive you
                pick the embedding array; 1-D arrays of the same length can supply IDs and labels. Pickled
                object arrays are refused for safety.
              </p>
            </div>
          </div>
        </div>
      )}

      {step === 1 && session && (
        <PreviewStep
          session={session}
          arrayMapping={arrayMapping}
          setArrayMapping={setArrayMapping}
          reload={(h) => void loadFile(session.file, h)}
        />
      )}

      {step === 2 && session?.preview.kind === 'table' && tableMapping && (
        <FeatureStep preview={session.preview} mapping={tableMapping} setMapping={setTableMapping} />
      )}
      {step === 2 && session?.preview.kind === 'arrays' && arrayMapping && (
        <Callout tone="info" title="Embedding matrix">
          Using “{arrayMapping.embedding}” (
          {describeShape(
            session.preview.arrays.find((a) => a.name === arrayMapping.embedding)?.array?.shape ?? [],
          )}
          ) as the N × D feature matrix. Every column of the array is a feature.
        </Callout>
      )}

      {step === 3 && session?.preview.kind === 'table' && tableMapping && (
        <MetadataStep preview={session.preview} mapping={tableMapping} setMapping={setTableMapping} />
      )}
      {step === 3 && session?.preview.kind === 'arrays' && arrayMapping && (
        <ArrayMetadataStep preview={session.preview} mapping={arrayMapping} setMapping={setArrayMapping} />
      )}

      {step === 4 && extracted && (
        <ValidateStep
          data={extracted}
          policy={policy}
          setPolicy={setPolicy}
          idStrategy={idStrategy}
          setIdStrategy={setIdStrategy}
        />
      )}

      {step === 5 && extracted && session && (
        <div className="space-y-4">
          <div className="grid gap-3 sm:grid-cols-2">
            <label className="block text-xs text-muted">
              Dataset name
              <TextInput className="mt-1.5" value={name} onChange={(e) => setName(e.target.value)} />
            </label>
            <div className="text-xs text-muted">
              Source
              <p className="mt-2 text-fg">
                {session.file.name} <Badge>{session.format.toUpperCase()}</Badge>
              </p>
            </div>
          </div>
          <ul className="grid gap-2 text-xs sm:grid-cols-3">
            <li className="rounded-lg border border-line bg-surface p-3">
              <p className="text-subtle">Observations</p>
              <p className="num mt-1 text-base font-semibold">{formatInteger(extracted.n)}</p>
            </li>
            <li className="rounded-lg border border-line bg-surface p-3">
              <p className="text-subtle">Features</p>
              <p className="num mt-1 text-base font-semibold">{formatInteger(extracted.d)}</p>
            </li>
            <li className="rounded-lg border border-line bg-surface p-3">
              <p className="text-subtle">Metadata columns</p>
              <p className="num mt-1 text-base font-semibold">{extracted.columns.length}</p>
            </li>
          </ul>
          <p className="text-xs text-subtle">
            Invalid values:{' '}
            <span className="text-fg">
              {policy === 'reject'
                ? 'reject the import if any are present'
                : policy === 'drop-rows'
                  ? 'drop affected observations'
                  : 'impute the feature mean'}
            </span>{' '}
            · Identifiers:{' '}
            <span className="text-fg">
              {idStrategy === 'column' ? 'from the selected column' : 'generated from row numbers'}
            </span>
          </p>
          <Switch
            label="Save to this browser’s local library (IndexedDB)"
            checked={saveLocally}
            onChange={setSaveLocally}
          />
        </div>
      )}
    </Dialog>
  );
}

function PreviewStep({
  session,
  arrayMapping,
  setArrayMapping,
  reload,
}: {
  session: ImportSession;
  arrayMapping: ArrayMapping | null;
  setArrayMapping: (m: ArrayMapping) => void;
  reload: (hasHeader: boolean) => void;
}) {
  const p = session.preview;
  if (p.kind === 'table') {
    const cols = p.columns.slice(0, 14);
    return (
      <div className="space-y-3">
        <div className="flex flex-wrap items-center gap-3 text-xs text-muted">
          <span>
            {p.fileName} · {formatBytes(p.sizeBytes)} · {p.columns.length} columns
            {p.totalRows !== null && ` · ${formatInteger(p.totalRows)} rows`}
          </span>
          {p.format !== 'json' && (
            <label className="flex items-center gap-1.5">
              <input
                type="checkbox"
                checked={p.hasHeader}
                onChange={(e) => reload(e.target.checked)}
                className="accent-[var(--color-accent)]"
              />
              First row contains column names
            </label>
          )}
        </div>
        {p.warnings.map((w) => (
          <Callout key={w} tone="warning">
            {w}
          </Callout>
        ))}
        <div className="scroll-thin overflow-auto rounded-lg border border-line">
          <table className="text-xs">
            <thead className="bg-surface">
              <tr>
                {cols.map((c, i) => (
                  <th key={c} className="px-2 py-1.5 text-left font-medium whitespace-nowrap text-fg">
                    {c}
                    <span className="ml-1 text-2xs font-normal text-subtle">
                      {p.inferred[i]!.numeric ? 'num' : 'text'}
                    </span>
                  </th>
                ))}
                {p.columns.length > cols.length && (
                  <th className="px-2 py-1.5 text-subtle">+{p.columns.length - cols.length} more</th>
                )}
              </tr>
            </thead>
            <tbody>
              {p.rows.slice(0, 12).map((row, r) => (
                <tr key={r} className="border-t border-line/60">
                  {cols.map((_, c) => (
                    <td key={c} className="num max-w-[12rem] truncate px-2 py-1 text-muted">
                      {row[c] === null || row[c] === undefined ? (
                        <span className="text-subtle">∅</span>
                      ) : (
                        String(row[c])
                      )}
                    </td>
                  ))}
                  {p.columns.length > cols.length && <td />}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <p className="text-2xs text-subtle">
          Showing up to 12 rows. Column types are inferred from the first {p.rows.length} rows; every value is
          validated during import.
        </p>
      </div>
    );
  }
  return (
    <div className="space-y-3">
      <p className="text-xs text-muted">
        {p.fileName} · {formatBytes(p.sizeBytes)} · {p.arrays.length} array{p.arrays.length === 1 ? '' : 's'}.
        Choose the embedding matrix:
      </p>
      <div role="radiogroup" aria-label="Embedding array" className="space-y-1.5">
        {p.arrays.map((a) => {
          const check = a.array
            ? embeddingCandidate(a.array, arrayMapping?.flattenTrailing ?? false)
            : { ok: false, reason: a.error ?? 'unreadable' };
          return (
            <label
              key={a.name}
              className={cn(
                'flex items-center gap-3 rounded-lg border px-3 py-2 text-xs',
                arrayMapping?.embedding === a.name ? 'border-accent/60 bg-accent/5' : 'border-line',
                !check.ok && 'opacity-60',
              )}
            >
              <input
                type="radio"
                name="embedding"
                disabled={!check.ok}
                checked={arrayMapping?.embedding === a.name}
                onChange={() =>
                  arrayMapping &&
                  setArrayMapping({
                    ...initialArrayMapping(p, a.name),
                    flattenTrailing: arrayMapping.flattenTrailing,
                  })
                }
                className="accent-[var(--color-accent)]"
              />
              <span className="font-medium text-fg">{a.name}</span>
              {a.array && (
                <span className="num text-subtle">
                  {describeShape(a.array.shape)} · {a.array.dtype}
                  {a.array.fortranOrder && ' · Fortran order'}
                </span>
              )}
              {!check.ok && <span className="ml-auto text-subtle">{check.reason}</span>}
            </label>
          );
        })}
      </div>
      {p.arrays.some((a) => a.array && a.array.shape.length > 2) && arrayMapping && (
        <Checkbox
          label="Flatten trailing dimensions"
          description="Treat an N × H × W array as N observations with H·W features (row-major)."
          checked={arrayMapping.flattenTrailing}
          onChange={(v) => setArrayMapping({ ...arrayMapping, flattenTrailing: v })}
        />
      )}
    </div>
  );
}

function FeatureStep({
  preview,
  mapping,
  setMapping,
}: {
  preview: TablePreview;
  mapping: TableMapping;
  setMapping: (m: TableMapping) => void;
}) {
  const [query, setQuery] = useState('');
  const shown = preview.inferred.filter((c) => c.name.toLowerCase().includes(query.toLowerCase()));
  const count = Object.values(mapping.assignments).filter((a) => a === 'feature').length;
  const setAll = (fn: (c: (typeof preview.inferred)[number]) => boolean) => {
    const assignments = { ...mapping.assignments };
    for (const c of preview.inferred) {
      if (fn(c)) assignments[c.name] = 'feature';
      else if (assignments[c.name] === 'feature') assignments[c.name] = 'ignore';
    }
    setMapping({ ...mapping, assignments });
  };
  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        <p className="text-xs text-muted">
          Select the embedding features. <span className="num text-fg">{count}</span> selected.
        </p>
        <Button
          size="xs"
          variant="ghost"
          className="ml-auto"
          onClick={() => setAll((c) => c.numeric && c.suggestedRole === 'feature')}
        >
          Suggested
        </Button>
        <Button size="xs" variant="ghost" onClick={() => setAll((c) => c.numeric)}>
          All numeric
        </Button>
        <Button size="xs" variant="ghost" onClick={() => setAll(() => false)}>
          None
        </Button>
        <TextInput
          className="max-w-48"
          placeholder="Filter columns…"
          aria-label="Filter columns"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
        />
      </div>
      <div className="scroll-thin grid max-h-[50vh] gap-1 overflow-y-auto sm:grid-cols-2 lg:grid-cols-3">
        {shown.map((c) => (
          <label
            key={c.name}
            className={cn(
              'flex items-center gap-2 rounded-md border px-2.5 py-1.5 text-xs',
              mapping.assignments[c.name] === 'feature' ? 'border-accent/50 bg-accent/5' : 'border-line',
            )}
          >
            <input
              type="checkbox"
              checked={mapping.assignments[c.name] === 'feature'}
              onChange={(e) =>
                setMapping({
                  ...mapping,
                  assignments: {
                    ...mapping.assignments,
                    [c.name]: e.target.checked
                      ? 'feature'
                      : c.suggestedRole === 'feature'
                        ? 'ignore'
                        : c.suggestedRole,
                  },
                })
              }
              className="accent-[var(--color-accent)]"
            />
            <span className="truncate text-fg">{c.name}</span>
            <span className={cn('ml-auto text-2xs', c.numeric ? 'text-teal' : 'text-warning')}>
              {c.numeric ? 'numeric' : 'non-numeric'}
            </span>
          </label>
        ))}
      </div>
      {shown.some((c) => !c.numeric && mapping.assignments[c.name] === 'feature') && (
        <Callout tone="warning">
          Some selected columns contain non-numeric values in the preview. They will be reported during
          validation, not silently converted.
        </Callout>
      )}
    </div>
  );
}

function MetadataStep({
  preview,
  mapping,
  setMapping,
}: {
  preview: TablePreview;
  mapping: TableMapping;
  setMapping: (m: TableMapping) => void;
}) {
  const others = preview.inferred.filter((c) => mapping.assignments[c.name] !== 'feature');
  if (others.length === 0)
    return (
      <Callout tone="info">
        All columns are features. Identifiers will be generated from row numbers; you can still label the data
        later by importing a file that includes metadata columns.
      </Callout>
    );
  return (
    <div className="space-y-3">
      <p className="text-xs text-muted">
        Assign a role to each non-feature column. Labels are optional; nothing is assumed.
      </p>
      <div className="scroll-thin max-h-[50vh] overflow-y-auto rounded-lg border border-line">
        <table className="w-full text-xs">
          <thead className="sticky top-0 bg-surface text-left text-2xs text-subtle uppercase">
            <tr>
              <th className="px-3 py-2 font-medium">Column</th>
              <th className="px-3 py-2 font-medium">Example values</th>
              <th className="px-3 py-2 font-medium">Role</th>
              <th className="px-3 py-2 font-medium">Type</th>
            </tr>
          </thead>
          <tbody>
            {others.map((c) => {
              const idx = preview.columns.indexOf(c.name);
              const examples = preview.rows.slice(0, 3).map((r) => r[idx]);
              return (
                <tr key={c.name} className="border-t border-line/60">
                  <td className="px-3 py-2 font-medium text-fg">{c.name}</td>
                  <td className="num max-w-[14rem] truncate px-3 py-2 text-subtle">
                    {examples.map((e) => (e === null ? '∅' : String(e))).join(', ')}
                  </td>
                  <td className="w-56 px-3 py-2">
                    <Select
                      ariaLabel={`Role of ${c.name}`}
                      value={mapping.assignments[c.name] ?? 'ignore'}
                      onChange={(v) => {
                        const assignments = { ...mapping.assignments };
                        if (v === 'id')
                          for (const k of Object.keys(assignments))
                            if (assignments[k] === 'id') assignments[k] = 'custom';
                        assignments[c.name] = v;
                        setMapping({ ...mapping, assignments });
                      }}
                      options={ROLE_OPTIONS}
                    />
                  </td>
                  <td className="w-36 px-3 py-2">
                    <Select
                      ariaLabel={`Type of ${c.name}`}
                      value={mapping.kinds[c.name] ?? 'categorical'}
                      onChange={(v) =>
                        setMapping({ ...mapping, kinds: { ...mapping.kinds, [c.name]: v as ColumnKind } })
                      }
                      options={[
                        { value: 'categorical', label: 'Categorical' },
                        { value: 'numeric', label: 'Numeric', disabled: !c.numeric },
                        { value: 'text', label: 'Text' },
                      ]}
                    />
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function ArrayMetadataStep({
  preview,
  mapping,
  setMapping,
}: {
  preview: ArrayPreview;
  mapping: ArrayMapping;
  setMapping: (m: ArrayMapping) => void;
}) {
  const n = preview.arrays.find((a) => a.name === mapping.embedding)?.array?.shape[0];
  const candidates = preview.arrays.filter(
    (a) => a.name !== mapping.embedding && a.array && a.array.shape.length === 1 && a.array.shape[0] === n,
  );
  if (candidates.length === 0) {
    return (
      <Callout tone="info">
        No 1-D arrays of length {n} are available as metadata. Identifiers will be generated from row numbers.
      </Callout>
    );
  }
  return (
    <div className="space-y-2">
      <p className="text-xs text-muted">
        1-D arrays with one entry per observation can provide identifiers and metadata.
      </p>
      {candidates.map((a) => (
        <div
          key={a.name}
          className="grid grid-cols-[1fr_14rem] items-center gap-3 rounded-lg border border-line px-3 py-2 text-xs"
        >
          <span>
            <span className="font-medium text-fg">{a.name}</span>{' '}
            <span className="num text-subtle">{a.array!.dtype}</span>
          </span>
          <Select
            ariaLabel={`Role of ${a.name}`}
            value={mapping.metadata[a.name] ?? 'ignore'}
            onChange={(v) => {
              const metadata = { ...mapping.metadata };
              if (v === 'id')
                for (const k of Object.keys(metadata)) if (metadata[k] === 'id') metadata[k] = 'custom';
              metadata[a.name] = v as ColumnRole | 'id' | 'ignore';
              setMapping({ ...mapping, metadata });
            }}
            options={ROLE_OPTIONS}
          />
        </div>
      ))}
    </div>
  );
}

function ValidateStep({
  data,
  policy,
  setPolicy,
  idStrategy,
  setIdStrategy,
}: {
  data: ExtractedData;
  policy: MissingValuePolicy;
  setPolicy: (p: MissingValuePolicy) => void;
  idStrategy: IdStrategy;
  setIdStrategy: (s: IdStrategy) => void;
}) {
  const report = useMemo(() => validateExtracted(data, idStrategy), [data, idStrategy]);
  const invalid = data.issues.missing + data.issues.nonNumeric + data.issues.infinite;
  const memory = estimateMemoryBytes(data.n, data.d);
  const budget = memoryBudgetBytes();
  return (
    <div className="space-y-4">
      <div className="grid gap-2 text-xs sm:grid-cols-4">
        {[
          ['Observations', formatInteger(data.n)],
          ['Features', formatInteger(data.d)],
          ['Invalid feature values', formatInteger(invalid)],
          ['Estimated memory', formatBytes(memory)],
        ].map(([k, v]) => (
          <div key={k} className="rounded-lg border border-line bg-surface p-3">
            <p className="text-subtle">{k}</p>
            <p className="num mt-1 text-base font-semibold text-fg">{v}</p>
          </div>
        ))}
      </div>
      {memory > budget.bytes * 0.4 && (
        <Callout tone="warning" title="This dataset may exceed the browser’s memory">
          Processing needs roughly {formatBytes(memory)} versus a budget of about {formatBytes(budget.bytes)}{' '}
          ({budget.source}). The tab may become slow or crash; consider importing a subset.
        </Callout>
      )}
      {report.errors.map((e) => (
        <Callout key={e} tone="danger">
          {e}
        </Callout>
      ))}
      {report.warnings.map((w) => (
        <Callout key={w} tone="warning">
          {w}
        </Callout>
      ))}
      {invalid > 0 && (
        <div className="space-y-2 rounded-lg border border-warning/30 p-3">
          <p className="text-xs text-fg">
            Found {data.issues.missing > 0 && `${formatInteger(data.issues.missing)} missing, `}
            {data.issues.nonNumeric > 0 && `${formatInteger(data.issues.nonNumeric)} non-numeric, `}
            {data.issues.infinite > 0 && `${formatInteger(data.issues.infinite)} infinite `}
            value(s) in {formatInteger(data.issues.rowsAffected)} observation(s). Choose how to handle them —
            nothing is discarded without your choice:
          </p>
          <ul className="num space-y-0.5 text-2xs text-subtle">
            {data.issues.examples.slice(0, 6).map((e, i) => (
              <li key={i}>
                row {e.row}, {e.column}: “{e.value}” ({e.kind})
              </li>
            ))}
          </ul>
          <Select
            ariaLabel="Invalid value policy"
            value={policy}
            onChange={(v) => setPolicy(v as MissingValuePolicy)}
            options={[
              { value: 'reject', label: 'Reject the import (fix the file first)' },
              {
                value: 'drop-rows',
                label: `Drop the ${formatInteger(data.issues.rowsAffected)} affected observation(s)`,
              },
              { value: 'impute-mean', label: 'Replace invalid values with the feature mean' },
            ]}
          />
        </div>
      )}
      <div className="space-y-2">
        <p className="text-xs font-medium text-muted">Observation identifiers</p>
        <Select
          ariaLabel="Identifier strategy"
          value={idStrategy}
          onChange={(v) => setIdStrategy(v as IdStrategy)}
          options={[
            { value: 'column', label: 'Use the selected identifier column', disabled: !data.ids },
            { value: 'row-number', label: 'Generate from row numbers (row_0001, …)' },
          ]}
        />
        <p className="text-2xs text-subtle">
          Stable identifiers are required to compare different representations of the same observations.
        </p>
      </div>
    </div>
  );
}
