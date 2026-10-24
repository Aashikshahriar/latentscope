import type { Dataset } from '@/types/dataset';

export interface Correspondence {
  /** Matched row in A and B for each matched observation, in A's order. */
  rowsA: Uint32Array;
  rowsB: Uint32Array;
  unmatchedA: string[];
  unmatchedB: string[];
  mode: 'id' | 'order';
}

/** Matches observations by identical identifiers. Never falls back to row position. */
export function matchById(a: Dataset, b: Dataset): Correspondence {
  const index = new Map<string, number>();
  b.ids.forEach((id, i) => index.set(id, i));
  const rowsA: number[] = [];
  const rowsB: number[] = [];
  const unmatchedA: string[] = [];
  const usedB = new Uint8Array(b.n);
  a.ids.forEach((id, i) => {
    const j = index.get(id);
    if (j === undefined) unmatchedA.push(id);
    else {
      rowsA.push(i);
      rowsB.push(j);
      usedB[j] = 1;
    }
  });
  const unmatchedB = b.ids.filter((_, j) => !usedB[j]);
  return {
    rowsA: Uint32Array.from(rowsA),
    rowsB: Uint32Array.from(rowsB),
    unmatchedA,
    unmatchedB,
    mode: 'id',
  };
}

/** Pairs rows by position; only valid when the user confirms both files list observations in the same order. */
export function matchByOrder(a: Dataset, b: Dataset): Correspondence {
  if (a.n !== b.n) throw new Error(`Row-order matching needs equal sizes (A has ${a.n} rows, B has ${b.n}).`);
  const rows = Uint32Array.from({ length: a.n }, (_, i) => i);
  return { rowsA: rows, rowsB: rows.slice(), unmatchedA: [], unmatchedB: [], mode: 'order' };
}

export function gatherRows(values: Float32Array, d: number, rows: Uint32Array): Float32Array {
  const out = new Float32Array(rows.length * d);
  rows.forEach((r, i) => out.set(values.subarray(r * d, r * d + d), i * d));
  return out;
}
