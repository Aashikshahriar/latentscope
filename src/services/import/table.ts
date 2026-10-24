import Papa from 'papaparse';
import type { ColumnKind } from '@/types/dataset';
import type {
  CellIssue,
  CellValue,
  ColumnInference,
  ExtractedData,
  TableMapping,
  TablePreview,
} from './types';
import type { MetadataColumn } from '@/types/dataset';

const MISSING_TOKENS = new Set(['', 'na', 'n/a', 'nan', 'null', 'none', '?', '-']);
const PREVIEW_ROWS = 200;
const FLOAT32_MAX = 3.4028234663852886e38;

export type ParsedCell =
  { kind: 'number'; value: number } | { kind: 'missing' } | { kind: 'text'; value: string };

/** Classifies one raw cell. Infinity tokens are numbers (flagged later), not text. */
export function parseCell(raw: CellValue | boolean | undefined): ParsedCell {
  if (raw === null || raw === undefined) return { kind: 'missing' };
  if (typeof raw === 'number')
    return Number.isNaN(raw) ? { kind: 'missing' } : { kind: 'number', value: raw };
  if (typeof raw === 'boolean') return { kind: 'number', value: raw ? 1 : 0 };
  const s = raw.trim();
  if (MISSING_TOKENS.has(s.toLowerCase())) return { kind: 'missing' };
  const lower = s.toLowerCase();
  if (lower === 'inf' || lower === 'infinity' || lower === '+inf' || lower === '+infinity')
    return { kind: 'number', value: Infinity };
  if (lower === '-inf' || lower === '-infinity') return { kind: 'number', value: -Infinity };
  // Number('') and Number('0x10') are accepted by JS; require a decimal / scientific literal.
  if (/^[+-]?(\d+\.?\d*|\.\d+)([eE][+-]?\d+)?$/.test(s)) return { kind: 'number', value: Number(s) };
  return { kind: 'text', value: s };
}

function looksLikeHeader(first: string[], second: string[] | undefined): boolean {
  if (!second) return first.some((c) => parseCell(c).kind === 'text');
  const firstText = first.filter((c) => parseCell(c).kind === 'text').length;
  const secondText = second.filter((c) => parseCell(c).kind === 'text').length;
  return firstText > secondText || (firstText > 0 && firstText === first.length);
}

const ID_NAMES = /^(id|sample_?id|observation_?id|uid|index|key|name_id)$/i;
const LABEL_NAMES = /^(label|labels|class|target|y|category|species|digit|topic)$/i;
const CLUSTER_NAMES = /cluster/i;
const IMAGE_NAMES = /(image|img|thumbnail|thumb).*(url|path)?$|_url$/i;
const TEXT_NAMES = /^(text|caption|description|sentence|document|content)$/i;
const MODEL_NAMES = /^(model|source_?model|encoder)$/i;
const MODALITY_NAMES = /^modality$/i;
const NAME_NAMES = /^(name|sample_?name|title|filename|file)$/i;

export function inferColumns(columns: string[], rows: CellValue[][]): ColumnInference[] {
  return columns.map((name, c) => {
    let numeric = true;
    let missing = 0;
    let longText = false;
    const distinct = new Set<string>();
    let isUrl = true;
    let anyValue = false;
    for (const row of rows) {
      const cell = parseCell(row[c]);
      if (cell.kind === 'missing') {
        missing++;
        continue;
      }
      anyValue = true;
      const str = cell.kind === 'number' ? String(cell.value) : cell.value;
      distinct.add(str);
      if (cell.kind === 'text') {
        numeric = false;
        if (cell.value.length > 40 || /\s\S+\s/.test(cell.value)) longText = true;
        if (!/^(https?:|data:image\/|\.{0,2}\/)/i.test(cell.value)) isUrl = false;
      } else {
        isUrl = false;
      }
    }
    if (!anyValue) {
      numeric = false;
      isUrl = false;
    }
    let suggestedRole: ColumnInference['suggestedRole'];
    let suggestedKind: ColumnKind = numeric ? 'numeric' : longText ? 'text' : 'categorical';
    if (ID_NAMES.test(name)) suggestedRole = 'id';
    else if (LABEL_NAMES.test(name)) {
      suggestedRole = 'label';
      suggestedKind = 'categorical';
    } else if (CLUSTER_NAMES.test(name)) {
      suggestedRole = 'cluster';
      suggestedKind = 'categorical';
    } else if (isUrl || IMAGE_NAMES.test(name)) {
      suggestedRole = isUrl ? 'image-url' : numeric ? 'feature' : 'custom';
      if (isUrl) suggestedKind = 'text';
    } else if (TEXT_NAMES.test(name) || longText) {
      suggestedRole = 'text';
      suggestedKind = 'text';
    } else if (MODEL_NAMES.test(name)) suggestedRole = 'source-model';
    else if (MODALITY_NAMES.test(name)) suggestedRole = 'modality';
    else if (NAME_NAMES.test(name) && !numeric) suggestedRole = 'sample-name';
    else if (numeric) suggestedRole = 'feature';
    else suggestedRole = 'custom';
    return { name, numeric, distinct: distinct.size, missing, suggestedRole, suggestedKind };
  });
}

function uniqueHeader(raw: string[]): string[] {
  const seen = new Map<string, number>();
  return raw.map((h, i) => {
    let name = (h ?? '').trim() || `column_${i + 1}`;
    const count = seen.get(name) ?? 0;
    seen.set(name, count + 1);
    if (count > 0) name = `${name}_${count + 1}`;
    return name;
  });
}

type CsvInput = File | string;

function papaRows(
  input: CsvInput,
  delimiter: ',' | '\t' | '',
  onRow: (row: string[], abort: () => void) => void,
): Promise<{ errors: string[] }> {
  return new Promise((resolve, reject) => {
    const errors: string[] = [];
    const config: Papa.ParseConfig<string[]> & {
      step: (r: Papa.ParseStepResult<string[]>, p: Papa.Parser) => void;
    } = {
      delimiter,
      skipEmptyLines: 'greedy',
      step: (result, parser) => {
        if (result.errors.length > 0 && errors.length < 5) {
          errors.push(...result.errors.map((e) => `Row ${(e.row ?? 0) + 1}: ${e.message}`));
        }
        onRow(result.data, () => parser.abort());
      },
    };
    if (typeof input === 'string') {
      Papa.parse<string[]>(input, { ...config, complete: () => resolve({ errors }) });
    } else {
      Papa.parse<string[]>(input, {
        ...config,
        complete: () => resolve({ errors }),
        error: (err: Error) => reject(err),
      } as Papa.ParseLocalConfig<string[], File>);
    }
  });
}

export async function previewDelimited(
  input: CsvInput,
  fileName: string,
  format: 'csv' | 'tsv',
  hasHeaderOverride?: boolean,
): Promise<TablePreview> {
  const raw: string[][] = [];
  const { errors } = await papaRows(input, format === 'tsv' ? '\t' : '', (row, abort) => {
    raw.push(row);
    if (raw.length > PREVIEW_ROWS) abort();
  });
  if (raw.length === 0) throw new Error('The file contains no rows.');
  const hasHeader = hasHeaderOverride ?? looksLikeHeader(raw[0]!, raw[1]);
  const width = Math.max(...raw.map((r) => r.length));
  const header = hasHeader
    ? uniqueHeader(raw[0]!)
    : Array.from({ length: width }, (_, i) => `column_${i + 1}`);
  while (header.length < width) header.push(`column_${header.length + 1}`);
  const rows = (hasHeader ? raw.slice(1) : raw).slice(0, PREVIEW_ROWS);
  const warnings = [...errors];
  if (raw.some((r) => r.length !== width))
    warnings.push('Some preview rows have a different number of fields than others.');
  return {
    kind: 'table',
    format,
    fileName,
    sizeBytes: typeof input === 'string' ? input.length : input.size,
    hasHeader,
    columns: header,
    rows,
    inferred: inferColumns(header, rows),
    totalRows: null,
    warnings,
  };
}

/** Accumulates selected columns while rows stream in. */
class TableAccumulator {
  private values: Float64Array;
  private n = 0;
  readonly featureCols: number[];
  readonly idCol: number;
  readonly metaCols: { index: number; name: string; role: MetadataColumn['role']; kind: ColumnKind }[];
  private ids: string[] = [];
  private meta: CellValue[][];
  issues: ExtractedData['issues'] = {
    missing: 0,
    nonNumeric: 0,
    infinite: 0,
    outOfRange: 0,
    rowsAffected: 0,
    examples: [],
  };
  raggedRows = 0;

  constructor(
    readonly columns: string[],
    mapping: TableMapping,
    readonly expectedWidth: number,
  ) {
    this.featureCols = columns.map((_, i) => i).filter((i) => mapping.assignments[columns[i]!] === 'feature');
    this.idCol = columns.findIndex((c) => mapping.assignments[c] === 'id');
    this.metaCols = columns
      .map((name, index) => ({ name, index, a: mapping.assignments[name] }))
      .filter((c) => c.a !== undefined && c.a !== 'feature' && c.a !== 'id' && c.a !== 'ignore')
      .map((c) => ({
        index: c.index,
        name: c.name,
        role: c.a as MetadataColumn['role'],
        kind: mapping.kinds[c.name] ?? 'categorical',
      }));
    this.meta = this.metaCols.map(() => []);
    this.values = new Float64Array(Math.max(1024, this.featureCols.length * 1024));
  }

  private note(issue: CellIssue): void {
    if (this.issues.examples.length < 12) this.issues.examples.push(issue);
  }

  push(row: CellValue[]): void {
    const d = this.featureCols.length;
    if (row.length !== this.expectedWidth) this.raggedRows++;
    if ((this.n + 1) * d > this.values.length) {
      const next = new Float64Array(this.values.length * 2);
      next.set(this.values);
      this.values = next;
    }
    let affected = false;
    const base = this.n * d;
    for (let t = 0; t < d; t++) {
      const c = this.featureCols[t]!;
      const cell = parseCell(row[c]);
      let v: number;
      if (cell.kind === 'number') {
        v = cell.value;
        if (!Number.isFinite(v)) {
          this.issues.infinite++;
          affected = true;
          this.note({ row: this.n + 1, column: this.columns[c]!, value: String(row[c]), kind: 'infinite' });
        } else if (Math.abs(v) > FLOAT32_MAX) {
          this.issues.outOfRange++;
          affected = true;
          this.note({
            row: this.n + 1,
            column: this.columns[c]!,
            value: String(row[c]),
            kind: 'out-of-range',
          });
        }
      } else {
        v = Number.NaN;
        affected = true;
        if (cell.kind === 'missing') {
          this.issues.missing++;
          this.note({
            row: this.n + 1,
            column: this.columns[c]!,
            value: String(row[c] ?? ''),
            kind: 'missing',
          });
        } else {
          this.issues.nonNumeric++;
          this.note({ row: this.n + 1, column: this.columns[c]!, value: cell.value, kind: 'non-numeric' });
        }
      }
      this.values[base + t] = v;
    }
    if (affected) this.issues.rowsAffected++;
    if (this.idCol >= 0) {
      const cell = row[this.idCol];
      this.ids.push(cell === null || cell === undefined ? '' : String(cell).trim());
    }
    this.metaCols.forEach((m, k) => {
      const cell = parseCell(row[m.index]);
      let value: CellValue;
      if (cell.kind === 'missing') value = null;
      else if (m.kind === 'numeric') value = cell.kind === 'number' ? cell.value : null;
      else value = cell.kind === 'number' ? String(row[m.index]).trim() : cell.value;
      this.meta[k]!.push(value);
    });
    this.n++;
  }

  result(extraWarnings: string[]): ExtractedData {
    const d = this.featureCols.length;
    const warnings = [...extraWarnings];
    if (this.raggedRows > 0)
      warnings.push(
        `${this.raggedRows} row(s) had a different number of fields; missing fields were treated as missing values.`,
      );
    const columns: MetadataColumn[] = this.metaCols.map((m, k) => ({
      name: m.name,
      role: m.role,
      kind: m.kind,
      values: this.meta[k]!,
    }));
    for (const col of columns) {
      if (col.kind === 'numeric') {
        const lost = col.values.filter((v) => v === null).length;
        if (lost > 0)
          warnings.push(
            `Metadata column "${col.name}": ${lost} empty or non-numeric value(s) stored as missing.`,
          );
      }
    }
    return {
      n: this.n,
      d,
      values: this.values.slice(0, this.n * d),
      featureNames: this.featureCols.map((c) => this.columns[c]!),
      ids: this.idCol >= 0 ? this.ids : null,
      columns,
      issues: this.issues,
      warnings,
    };
  }
}

export async function extractDelimited(
  input: CsvInput,
  format: 'csv' | 'tsv',
  columns: string[],
  mapping: TableMapping,
): Promise<ExtractedData> {
  const acc = new TableAccumulator(columns, mapping, columns.length);
  if (acc.featureCols.length === 0) throw new Error('Select at least one feature column.');
  let first = true;
  const { errors } = await papaRows(input, format === 'tsv' ? '\t' : '', (row) => {
    if (first && mapping.hasHeader) {
      first = false;
      return;
    }
    first = false;
    acc.push(row);
  });
  return acc.result(errors);
}

// ---------------------------------------------------------------- JSON

interface JsonTable {
  columns: string[];
  rows: CellValue[][];
  warnings: string[];
}

function isNumberArray(v: unknown): v is number[] {
  return Array.isArray(v) && v.every((x) => typeof x === 'number' || x === null);
}

/**
 * Normalises the JSON layouts LatentScope accepts into a table:
 *  1. an array of row objects, where array-valued fields (e.g. "embedding": [...]) are expanded
 *     into numbered feature columns;
 *  2. an object of parallel arrays: { embeddings | vectors | X | data: number[][], ids?, labels?,
 *     metadata?: { column: [...] } };
 *  3. LatentScope's dataset format { n, d, values (flat), featureNames, ids, columns };
 *  4. an array of numeric arrays.
 */
export function jsonToTable(parsed: unknown): JsonTable {
  const warnings: string[] = [];
  if (Array.isArray(parsed)) {
    if (parsed.length === 0) throw new Error('The JSON array is empty.');
    if (parsed.every(isNumberArray)) {
      const width = Math.max(...parsed.map((r) => r.length));
      return {
        columns: Array.from({ length: width }, (_, i) => `feature_${i}`),
        rows: parsed as CellValue[][],
        warnings,
      };
    }
    if (parsed.every((r) => r !== null && typeof r === 'object' && !Array.isArray(r))) {
      const objects = parsed as Record<string, unknown>[];
      const keys: string[] = [];
      const seen = new Set<string>();
      const arrayWidths = new Map<string, number>();
      for (const obj of objects) {
        for (const [k, v] of Object.entries(obj)) {
          if (!seen.has(k)) {
            seen.add(k);
            keys.push(k);
          }
          if (isNumberArray(v)) arrayWidths.set(k, Math.max(arrayWidths.get(k) ?? 0, v.length));
        }
      }
      const columns: string[] = [];
      for (const k of keys) {
        const w = arrayWidths.get(k);
        if (w !== undefined) for (let i = 0; i < w; i++) columns.push(`${k}_${i}`);
        else columns.push(k);
      }
      const rows = objects.map((obj) => {
        const row: CellValue[] = [];
        for (const k of keys) {
          const v = obj[k];
          const w = arrayWidths.get(k);
          if (w !== undefined) {
            const arr = isNumberArray(v) ? v : [];
            for (let i = 0; i < w; i++) row.push(arr[i] ?? null);
          } else row.push(toCell(v));
        }
        return row;
      });
      for (const [k, w] of arrayWidths) {
        const short = objects.filter((o) => !isNumberArray(o[k]) || (o[k] as number[]).length !== w).length;
        if (short > 0)
          warnings.push(
            `Field "${k}": ${short} row(s) have fewer than ${w} values; the gaps are missing values.`,
          );
      }
      return { columns, rows, warnings };
    }
    throw new Error('A top-level JSON array must contain either row objects or numeric arrays.');
  }
  if (parsed && typeof parsed === 'object') {
    const obj = parsed as Record<string, unknown>;
    if (typeof obj.n === 'number' && typeof obj.d === 'number' && Array.isArray(obj.values)) {
      return fromLatentScopeFormat(obj);
    }
    const matrixKey = ['embeddings', 'embedding', 'vectors', 'X', 'x', 'data', 'features'].find(
      (k) => Array.isArray(obj[k]) && (obj[k] as unknown[]).every(isNumberArray),
    );
    if (!matrixKey) {
      throw new Error(
        'Could not find an embedding matrix. Expected a field such as "embeddings": [[...], ...].',
      );
    }
    const matrix = obj[matrixKey] as number[][];
    const width = Math.max(...matrix.map((r) => r.length));
    const columns = Array.from({ length: width }, (_, i) => `${matrixKey}_${i}`);
    const extra: { name: string; values: unknown[] }[] = [];
    for (const key of ['ids', 'id', 'labels', 'label', 'names', 'texts', 'text']) {
      if (Array.isArray(obj[key])) extra.push({ name: key, values: obj[key] as unknown[] });
    }
    if (obj.metadata && typeof obj.metadata === 'object') {
      for (const [k, v] of Object.entries(obj.metadata as Record<string, unknown>))
        if (Array.isArray(v)) extra.push({ name: k, values: v });
    }
    for (const e of extra) {
      if (e.values.length !== matrix.length) {
        throw new Error(
          `Field "${e.name}" has ${e.values.length} entries but the matrix has ${matrix.length} rows.`,
        );
      }
    }
    const rows = matrix.map((r, i) => {
      const row: CellValue[] = [];
      for (let c = 0; c < width; c++) row.push(r[c] ?? null);
      for (const e of extra) row.push(toCell(e.values[i]));
      return row;
    });
    return { columns: [...columns, ...extra.map((e) => e.name)], rows, warnings };
  }
  throw new Error('Unsupported JSON structure.');
}

function toCell(v: unknown): CellValue {
  if (v === null || v === undefined) return null;
  if (typeof v === 'number' || typeof v === 'string') return v;
  if (typeof v === 'boolean') return v ? 'true' : 'false';
  return JSON.stringify(v);
}

function fromLatentScopeFormat(obj: Record<string, unknown>): JsonTable {
  const n = obj.n as number;
  const d = obj.d as number;
  const values = obj.values as unknown[];
  if (values.length !== n * d)
    throw new Error(`"values" has ${values.length} entries; expected n × d = ${n * d}.`);
  const featureNames = Array.isArray(obj.featureNames)
    ? (obj.featureNames as string[])
    : Array.from({ length: d }, (_, i) => `feature_${i}`);
  const ids = Array.isArray(obj.ids) ? (obj.ids as unknown[]) : null;
  const cols = Array.isArray(obj.columns) ? (obj.columns as { name: string; values: unknown[] }[]) : [];
  const columns = [...(ids ? ['id'] : []), ...featureNames, ...cols.map((c) => c.name)];
  const rows: CellValue[][] = [];
  for (let i = 0; i < n; i++) {
    const row: CellValue[] = [];
    if (ids) row.push(toCell(ids[i]));
    for (let t = 0; t < d; t++) row.push(toCell(values[i * d + t]));
    for (const c of cols) row.push(toCell(c.values[i]));
    rows.push(row);
  }
  return { columns, rows, warnings: [] };
}

export function previewJson(
  text: string,
  fileName: string,
  sizeBytes: number,
): { preview: TablePreview; table: JsonTable } {
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch (error) {
    throw new Error(`Invalid JSON: ${error instanceof Error ? error.message : String(error)}`);
  }
  const table = jsonToTable(parsed);
  const columns = uniqueHeader(table.columns);
  const rows = table.rows.slice(0, PREVIEW_ROWS);
  return {
    table: { ...table, columns },
    preview: {
      kind: 'table',
      format: 'json',
      fileName,
      sizeBytes,
      hasHeader: true,
      columns,
      rows,
      inferred: inferColumns(columns, rows),
      totalRows: table.rows.length,
      warnings: table.warnings,
    },
  };
}

export function extractJson(table: JsonTable, mapping: TableMapping): ExtractedData {
  const acc = new TableAccumulator(table.columns, mapping, table.columns.length);
  if (acc.featureCols.length === 0) throw new Error('Select at least one feature column.');
  for (const row of table.rows) acc.push(row);
  return acc.result(table.warnings);
}

export type { JsonTable };
