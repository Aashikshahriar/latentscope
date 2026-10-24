/**
 * Adjusted Rand Index (Hubert & Arabie, 1985) between two labelings of the same observations.
 * 1 = identical partitions (up to relabelling), ≈ 0 = chance agreement. Matches scikit-learn's
 * `adjusted_rand_score`.
 */
export function adjustedRandIndex(a: ArrayLike<number>, b: ArrayLike<number>): number {
  const n = a.length;
  if (n !== b.length) throw new RangeError('Labelings must have equal length.');
  if (n < 2) return 1;
  const table = new Map<string, number>();
  const rows = new Map<number, number>();
  const cols = new Map<number, number>();
  for (let i = 0; i < n; i++) {
    const key = `${a[i]}|${b[i]}`;
    table.set(key, (table.get(key) ?? 0) + 1);
    rows.set(a[i]!, (rows.get(a[i]!) ?? 0) + 1);
    cols.set(b[i]!, (cols.get(b[i]!) ?? 0) + 1);
  }
  const comb2 = (x: number) => (x * (x - 1)) / 2;
  let sumCells = 0;
  for (const v of table.values()) sumCells += comb2(v);
  let sumRows = 0;
  for (const v of rows.values()) sumRows += comb2(v);
  let sumCols = 0;
  for (const v of cols.values()) sumCols += comb2(v);
  const total = comb2(n);
  const expected = (sumRows * sumCols) / total;
  const max = (sumRows + sumCols) / 2;
  if (max === expected) return 1; // both partitions trivial (all-in-one or all singletons)
  return (sumCells - expected) / (max - expected);
}
