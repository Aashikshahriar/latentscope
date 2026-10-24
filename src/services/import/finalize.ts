import type { MissingValuePolicy } from '@/types/algorithms';
import type { Dataset, DatasetSource, MetadataColumn } from '@/types/dataset';
import { datasetChecksum } from '@/utils/checksum';
import { createId } from '@/utils/misc';
import type { ExtractedData } from './types';

export type IdStrategy = 'column' | 'row-number';

export interface FinalizeOptions {
  name: string;
  missingPolicy: MissingValuePolicy;
  idStrategy: IdStrategy;
  source: DatasetSource;
  description?: string;
}

export interface ValidationReport {
  errors: string[];
  warnings: string[];
  duplicateIds: string[];
  emptyIds: number;
  constantFeatures: number;
}

/** Checks that do not depend on the missing-value policy. */
export function validateExtracted(data: ExtractedData, idStrategy: IdStrategy): ValidationReport {
  const errors: string[] = [];
  const warnings = [...data.warnings];
  if (data.n === 0) errors.push('No observations were found.');
  if (data.d === 0) errors.push('No feature columns were selected.');
  if (data.n === 1) errors.push('At least two observations are required.');
  const duplicateIds: string[] = [];
  let emptyIds = 0;
  if (idStrategy === 'column') {
    if (!data.ids) errors.push('No identifier column was selected; choose one or use row numbers.');
    else {
      const seen = new Set<string>();
      const dupes = new Set<string>();
      for (const id of data.ids) {
        if (id === '') emptyIds++;
        else if (seen.has(id)) dupes.add(id);
        else seen.add(id);
      }
      duplicateIds.push(...[...dupes].slice(0, 20));
      if (dupes.size > 0) {
        errors.push(
          `${dupes.size} identifier(s) occur more than once (e.g. "${[...dupes].slice(0, 3).join('", "')}"). Identifiers must be unique.`,
        );
      }
      if (emptyIds > 0) errors.push(`${emptyIds} observation(s) have an empty identifier.`);
    }
  }
  if (data.issues.outOfRange > 0) {
    errors.push(
      `${data.issues.outOfRange} value(s) exceed the single-precision range (±3.4 × 10³⁸) used for storage.`,
    );
  }
  let constantFeatures = 0;
  if (data.n > 1) {
    for (let t = 0; t < data.d; t++) {
      let first = Number.NaN;
      let constant = true;
      for (let i = 0; i < data.n; i++) {
        const v = data.values[i * data.d + t]!;
        if (!Number.isFinite(v)) continue;
        if (Number.isNaN(first)) first = v;
        else if (v !== first) {
          constant = false;
          break;
        }
      }
      if (constant) constantFeatures++;
    }
  }
  if (constantFeatures > 0) {
    warnings.push(
      `${constantFeatures} feature(s) are constant across all observations; they carry no information but are kept.`,
    );
  }
  return { errors, warnings, duplicateIds, emptyIds, constantFeatures };
}

export interface PolicyOutcome {
  values: Float32Array;
  keptRows: Uint32Array | null;
  notes: string[];
  error: string | null;
}

/**
 * Applies the user's explicit choice for invalid cells (missing, non-numeric, infinite):
 *  - reject: refuse the import and explain where the problems are;
 *  - drop-rows: remove every affected observation (the count is recorded in the dataset notes);
 *  - impute-mean: replace invalid cells with the mean of the valid values in that feature.
 */
export function applyMissingPolicy(data: ExtractedData, policy: MissingValuePolicy): PolicyOutcome {
  const { n, d, values, issues } = data;
  const invalid = issues.missing + issues.nonNumeric + issues.infinite;
  if (invalid === 0) return { values: Float32Array.from(values), keptRows: null, notes: [], error: null };
  const summary = [
    issues.missing ? `${issues.missing} missing` : '',
    issues.nonNumeric ? `${issues.nonNumeric} non-numeric` : '',
    issues.infinite ? `${issues.infinite} infinite` : '',
  ]
    .filter(Boolean)
    .join(', ');
  if (policy === 'reject') {
    const where = issues.examples.slice(0, 3).map((e) => `row ${e.row}, ${e.column} = "${e.value}"`);
    return {
      values: new Float32Array(0),
      keptRows: null,
      notes: [],
      error: `The feature matrix contains ${summary} value(s) in ${issues.rowsAffected} observation(s) (first: ${where.join('; ')}). Choose to drop those rows or impute feature means.`,
    };
  }
  if (policy === 'drop-rows') {
    const keep: number[] = [];
    for (let i = 0; i < n; i++) {
      let ok = true;
      for (let t = 0; t < d && ok; t++) if (!Number.isFinite(values[i * d + t]!)) ok = false;
      if (ok) keep.push(i);
    }
    if (keep.length < 2) {
      return {
        values: new Float32Array(0),
        keptRows: null,
        notes: [],
        error: 'Dropping affected rows would leave fewer than two observations.',
      };
    }
    const out = new Float32Array(keep.length * d);
    keep.forEach((src, r) => out.set(values.subarray(src * d, src * d + d), r * d));
    return {
      values: out,
      keptRows: Uint32Array.from(keep),
      notes: [`Dropped ${n - keep.length} of ${n} observations containing ${summary} feature value(s).`],
      error: null,
    };
  }
  const means = new Float64Array(d);
  const counts = new Float64Array(d);
  for (let i = 0; i < n; i++) {
    for (let t = 0; t < d; t++) {
      const v = values[i * d + t]!;
      if (Number.isFinite(v)) {
        means[t]! += v;
        counts[t]!++;
      }
    }
  }
  const emptyFeatures: number[] = [];
  for (let t = 0; t < d; t++) {
    if (counts[t] === 0) emptyFeatures.push(t);
    means[t] = counts[t]! > 0 ? means[t]! / counts[t]! : 0;
  }
  if (emptyFeatures.length > 0) {
    return {
      values: new Float32Array(0),
      keptRows: null,
      notes: [],
      error: `${emptyFeatures.length} feature(s) have no valid values at all (e.g. "${data.featureNames[emptyFeatures[0]!]}"); deselect them.`,
    };
  }
  const out = new Float32Array(n * d);
  for (let i = 0; i < n; i++) {
    for (let t = 0; t < d; t++) {
      const v = values[i * d + t]!;
      out[i * d + t] = Number.isFinite(v) ? v : means[t]!;
    }
  }
  return {
    values: out,
    keptRows: null,
    notes: [
      `Replaced ${summary} feature value(s) in ${issues.rowsAffected} observation(s) with the feature mean.`,
    ],
    error: null,
  };
}

function selectColumnRows(columns: MetadataColumn[], rows: Uint32Array | null): MetadataColumn[] {
  if (!rows) return columns;
  return columns.map((c) => ({ ...c, values: Array.from(rows, (r) => c.values[r] ?? null) }));
}

export async function finalizeDataset(
  data: ExtractedData,
  options: FinalizeOptions,
): Promise<{ dataset: Dataset | null; report: ValidationReport; error: string | null }> {
  const report = validateExtracted(data, options.idStrategy);
  if (report.errors.length > 0) return { dataset: null, report, error: report.errors.join(' ') };
  const outcome = applyMissingPolicy(data, options.missingPolicy);
  if (outcome.error) return { dataset: null, report, error: outcome.error };
  const rows = outcome.keptRows;
  const n = rows ? rows.length : data.n;
  let ids: string[];
  const notes = [...outcome.notes];
  if (options.idStrategy === 'row-number' || !data.ids) {
    const width = String(data.n).length;
    // Identifiers refer to the original row numbers so they stay meaningful after dropping rows.
    ids = Array.from(
      { length: n },
      (_, r) => `row_${String((rows ? rows[r]! : r) + 1).padStart(width, '0')}`,
    );
    notes.push('Observation identifiers were generated from original row numbers.');
  } else {
    ids = rows ? Array.from(rows, (r) => data.ids![r]!) : data.ids;
  }
  const checksum = await datasetChecksum(outcome.values, n, data.d, ids);
  const dataset: Dataset = {
    id: createId('ds'),
    name: options.name.trim() || 'Untitled dataset',
    description: options.description,
    source: options.source,
    n,
    d: data.d,
    values: outcome.values,
    featureNames: data.featureNames,
    ids,
    columns: selectColumnRows(data.columns, rows),
    checksum,
    createdAt: new Date().toISOString(),
    importNotes: [...notes, ...report.warnings],
  };
  return { dataset, report, error: null };
}

/** Rough memory needed to hold and process a dataset (storage + preprocessing copy + worker copy). */
export function estimateMemoryBytes(n: number, d: number): number {
  return n * d * 4 /* stored float32 */ + n * d * 4 /* worker copy */ + n * d * 8; /* float64 working copy */
}

/** Best-effort memory budget for the current browser, in bytes. */
export function memoryBudgetBytes(): { bytes: number; source: string } {
  const perf =
    (globalThis.performance as Performance & { memory?: { jsHeapSizeLimit: number } }) ?? undefined;
  if (perf?.memory?.jsHeapSizeLimit)
    return { bytes: perf.memory.jsHeapSizeLimit, source: 'JavaScript heap limit' };
  const device = (globalThis.navigator as (Navigator & { deviceMemory?: number }) | undefined)?.deviceMemory;
  if (device)
    return {
      bytes: Math.min(device * 1024 ** 3 * 0.25, 4 * 1024 ** 3),
      source: `${device} GB device memory (approximate)`,
    };
  return { bytes: 2 * 1024 ** 3, source: 'default assumption (2 GB)' };
}
