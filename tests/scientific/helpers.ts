import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

export function loadFixture<T>(name: string): T {
  return JSON.parse(readFileSync(resolve(__dirname, 'fixtures', `${name}.json`), 'utf8')) as T;
}

export function flatten(rows: number[][]): Float64Array {
  const cols = rows[0]?.length ?? 0;
  const out = new Float64Array(rows.length * cols);
  rows.forEach((row, i) => out.set(row, i * cols));
  return out;
}

export function maxAbsDiff(a: ArrayLike<number>, b: ArrayLike<number>): number {
  let m = 0;
  for (let i = 0; i < a.length; i++) m = Math.max(m, Math.abs(a[i]! - b[i]!));
  return m;
}
