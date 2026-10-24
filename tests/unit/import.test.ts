import { describe, expect, it } from 'vitest';
import {
  extractDelimited,
  extractJson,
  inferColumns,
  jsonToTable,
  parseCell,
  previewDelimited,
  previewJson,
} from '@/services/import/table';
import { applyMissingPolicy, finalizeDataset, validateExtracted } from '@/services/import/finalize';
import { extractArrays } from '@/services/import/arrays';
import type { TableMapping } from '@/services/import/types';
import { detectFormat } from '@/services/import';

const CSV = `id,label,f1,f2,f3,note
a,cat,1,2,3,first row
b,dog,4,5,6,second
c,cat,7,8,9,third
d,dog,1.5,NaN,2,fourth
`;

describe('cell parsing', () => {
  it('distinguishes numbers, missing tokens, infinities and text', () => {
    expect(parseCell('1.5e3')).toEqual({ kind: 'number', value: 1500 });
    expect(parseCell(' -2 ')).toEqual({ kind: 'number', value: -2 });
    for (const m of ['', 'NA', 'nan', 'NULL', 'None', '?', null, undefined])
      expect(parseCell(m).kind).toBe('missing');
    expect(parseCell('inf')).toEqual({ kind: 'number', value: Infinity });
    expect(parseCell('-Infinity')).toEqual({ kind: 'number', value: -Infinity });
    expect(parseCell('0x10').kind).toBe('text');
    expect(parseCell('12abc').kind).toBe('text');
  });
  it('detects formats by extension', () => {
    expect(detectFormat('a.CSV')).toBe('csv');
    expect(detectFormat('a.tsv')).toBe('tsv');
    expect(detectFormat('a.npz')).toBe('npz');
    expect(detectFormat('a.xlsx')).toBeNull();
  });
});

describe('CSV import', () => {
  it('previews with header detection and role inference', async () => {
    const p = await previewDelimited(CSV, 'x.csv', 'csv');
    expect(p.hasHeader).toBe(true);
    expect(p.columns).toEqual(['id', 'label', 'f1', 'f2', 'f3', 'note']);
    const roles = Object.fromEntries(p.inferred.map((c) => [c.name, c.suggestedRole]));
    expect(roles).toMatchObject({ id: 'id', label: 'label', f1: 'feature', f2: 'feature', f3: 'feature' });
  });

  it('extracts features and metadata, reporting every invalid cell', async () => {
    const mapping: TableMapping = {
      hasHeader: true,
      assignments: { id: 'id', label: 'label', f1: 'feature', f2: 'feature', f3: 'feature', note: 'text' },
      kinds: { label: 'categorical', note: 'text' },
    };
    const data = await extractDelimited(CSV, 'csv', ['id', 'label', 'f1', 'f2', 'f3', 'note'], mapping);
    expect(data.n).toBe(4);
    expect(data.d).toBe(3);
    expect(data.ids).toEqual(['a', 'b', 'c', 'd']);
    expect(data.columns.map((c) => c.name)).toEqual(['label', 'note']);
    expect(data.issues.missing).toBe(1);
    expect(data.issues.rowsAffected).toBe(1);
    expect(data.issues.examples[0]).toMatchObject({ row: 4, column: 'f2', kind: 'missing' });
  });

  it('applies missing-value policies explicitly', async () => {
    const mapping: TableMapping = {
      hasHeader: true,
      assignments: { id: 'id', f1: 'feature', f2: 'feature', f3: 'feature' },
      kinds: {},
    };
    const data = await extractDelimited(CSV, 'csv', ['id', 'label', 'f1', 'f2', 'f3', 'note'], mapping);
    expect(applyMissingPolicy(data, 'reject').error).toMatch(/1 missing/);
    const dropped = applyMissingPolicy(data, 'drop-rows');
    expect(dropped.values.length).toBe(9);
    expect(Array.from(dropped.keptRows!)).toEqual([0, 1, 2]);
    const imputed = applyMissingPolicy(data, 'impute-mean');
    expect(imputed.values[3 * 3 + 1]).toBeCloseTo((2 + 5 + 8) / 3, 6);
    expect(imputed.notes[0]).toMatch(/Replaced 1 missing/);
  });

  it('finalizes a dataset with checksum and rejects duplicate identifiers', async () => {
    const mapping: TableMapping = {
      hasHeader: true,
      assignments: { id: 'id', label: 'label', f1: 'feature', f3: 'feature' },
      kinds: { label: 'categorical' },
    };
    const data = await extractDelimited(CSV, 'csv', ['id', 'label', 'f1', 'f2', 'f3', 'note'], mapping);
    const { dataset, error } = await finalizeDataset(data, {
      name: 'T',
      missingPolicy: 'reject',
      idStrategy: 'column',
      source: { type: 'upload', fileName: 'x.csv', format: 'csv' },
    });
    expect(error).toBeNull();
    expect(dataset!.checksum).toMatch(/^[0-9a-f]{64}$/);
    expect(dataset!.columns[0]!.values).toEqual(['cat', 'dog', 'cat', 'dog']);
    const dupes = await extractDelimited('id,x\na,1\na,2\n', 'csv', ['id', 'x'], {
      hasHeader: true,
      assignments: { id: 'id', x: 'feature' },
      kinds: {},
    });
    expect(validateExtracted(dupes, 'column').errors[0]).toMatch(/more than once/);
    expect(validateExtracted(dupes, 'row-number').errors).toEqual([]);
  });

  it('flags non-numeric feature values instead of converting them', async () => {
    const data = await extractDelimited('x,y\n1,2\n3,abc\n', 'csv', ['x', 'y'], {
      hasHeader: true,
      assignments: { x: 'feature', y: 'feature' },
      kinds: {},
    });
    expect(data.issues.nonNumeric).toBe(1);
    expect(applyMissingPolicy(data, 'reject').error).toMatch(/non-numeric/);
  });

  it('reads TSV with generated header names when there is no header row', async () => {
    const p = await previewDelimited('1\t2\n3\t4\n', 'x.tsv', 'tsv');
    expect(p.hasHeader).toBe(false);
    expect(p.columns).toEqual(['column_1', 'column_2']);
  });
});

describe('JSON import', () => {
  it('expands array-valued fields of row objects into feature columns', () => {
    const table = jsonToTable([
      { id: 'a', embedding: [1, 2, 3], label: 'x' },
      { id: 'b', embedding: [4, 5, 6], label: 'y' },
    ]);
    expect(table.columns).toEqual(['id', 'embedding_0', 'embedding_1', 'embedding_2', 'label']);
    expect(table.rows[1]).toEqual(['b', 4, 5, 6, 'y']);
  });

  it('reads the parallel-array layout and validates lengths', () => {
    const t = jsonToTable({
      embeddings: [
        [1, 2],
        [3, 4],
      ],
      ids: ['p', 'q'],
      labels: ['u', 'v'],
    });
    expect(t.columns).toEqual(['embeddings_0', 'embeddings_1', 'ids', 'labels']);
    expect(() => jsonToTable({ embeddings: [[1, 2]], ids: ['p', 'q'] })).toThrow(/2 entries/);
  });

  it('round-trips LatentScope’s own dataset format', () => {
    const { preview, table } = previewJson(
      JSON.stringify({
        n: 2,
        d: 2,
        values: [1, 2, 3, 4],
        featureNames: ['a', 'b'],
        ids: ['r1', 'r2'],
        columns: [{ name: 'label', values: ['x', 'y'] }],
      }),
      'd.json',
      10,
    );
    expect(preview.columns).toEqual(['id', 'a', 'b', 'label']);
    const data = extractJson(table, {
      hasHeader: true,
      assignments: { id: 'id', a: 'feature', b: 'feature', label: 'label' },
      kinds: { label: 'categorical' },
    });
    expect(Array.from(data.values)).toEqual([1, 2, 3, 4]);
    expect(data.ids).toEqual(['r1', 'r2']);
  });

  it('rejects malformed JSON with a clear message', () => {
    expect(() => previewJson('{oops', 'x.json', 5)).toThrow(/Invalid JSON/);
    expect(() => jsonToTable({ foo: 1 })).toThrow(/embedding matrix/);
  });
});

describe('array import', () => {
  it('requires 2-D numeric matrices and maps 1-D metadata arrays', () => {
    const preview = {
      kind: 'arrays' as const,
      format: 'npz' as const,
      fileName: 'x.npz',
      sizeBytes: 1,
      warnings: [],
      arrays: [
        {
          name: 'X',
          error: null,
          array: {
            dtype: '<f4',
            shape: [2, 2],
            fortranOrder: false,
            data: { kind: 'numeric' as const, values: Float64Array.from([1, 2, 3, 4]) },
          },
        },
        {
          name: 'y',
          error: null,
          array: {
            dtype: '<U1',
            shape: [2],
            fortranOrder: false,
            data: { kind: 'string' as const, values: ['a', 'b'] },
          },
        },
        {
          name: 'ids',
          error: null,
          array: {
            dtype: '<i8',
            shape: [2],
            fortranOrder: false,
            data: { kind: 'numeric' as const, values: Float64Array.from([10, 11]) },
          },
        },
      ],
    };
    const data = extractArrays(preview, {
      embedding: 'X',
      flattenTrailing: false,
      metadata: { y: 'label', ids: 'id' },
    });
    expect(data.ids).toEqual(['10', '11']);
    expect(data.columns[0]).toMatchObject({
      name: 'y',
      role: 'label',
      kind: 'categorical',
      values: ['a', 'b'],
    });
    expect(() => extractArrays(preview, { embedding: 'y', flattenTrailing: false, metadata: {} })).toThrow(
      /cannot be used/,
    );
  });
});

describe('column inference', () => {
  it('suggests text for long sentences and image-url for URLs', () => {
    const inf = inferColumns(
      ['caption', 'img'],
      [
        ['A cat sitting on a sofa in the sun', 'https://example.org/a.png'],
        ['A dog', 'https://example.org/b.png'],
      ],
    );
    expect(inf[0]!.suggestedRole).toBe('text');
    expect(inf[1]!.suggestedRole).toBe('image-url');
  });
});
