import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { NpyFormatError, parseNpy } from '@/services/import/npy';
import { parseNpz } from '@/services/import/npz';

const dir = resolve(__dirname, 'fixtures', 'npy');
const read = (name: string) => new Uint8Array(readFileSync(resolve(dir, name)));
const expected = JSON.parse(readFileSync(resolve(dir, 'expected.json'), 'utf8')) as { f32: number[][] };

describe('NPY parser (files written by NumPy)', () => {
  it('reads little-endian float32 C-order matrices exactly', () => {
    const a = parseNpy(read('f32_c.npy'));
    expect(a.shape).toEqual([5, 3]);
    expect(a.dtype).toBe('<f4');
    expect(a.data.kind).toBe('numeric');
    const flat = expected.f32.flat();
    if (a.data.kind === 'numeric') a.data.values.forEach((v, i) => expect(v).toBe(Math.fround(flat[i]!)));
  });

  it('converts Fortran-order arrays to row-major', () => {
    const a = parseNpy(read('f64_fortran.npy'));
    expect(a.fortranOrder).toBe(true);
    expect(a.shape).toEqual([4, 3]);
  });

  it('reads big-endian int16 and uint8', () => {
    const a = parseNpy(read('i16_be.npy'));
    expect(a.shape).toEqual([3, 4]);
    expect(a.data.kind === 'numeric' && Array.from(a.data.values)).toEqual(
      Array.from({ length: 12 }, (_, i) => i),
    );
    const u = parseNpy(read('u8.npy'));
    expect(u.data.kind === 'numeric' && Array.from(u.data.values)).toEqual([0, 1, 2, 3, 4, 5]);
  });

  it('reads unicode string arrays and booleans', () => {
    const s = parseNpy(read('labels_u.npy'));
    expect(s.data).toEqual({ kind: 'string', values: ['cat', 'dog', 'bird', 'cat', 'fish'] });
    const b = parseNpy(read('bool.npy'));
    expect(b.data.kind === 'numeric' && Array.from(b.data.values)).toEqual([1, 0, 1]);
  });

  it('reports 1-D and 3-D shapes without guessing', () => {
    expect(parseNpy(read('vector.npy')).shape).toEqual([4]);
    expect(parseNpy(read('cube.npy')).shape).toEqual([2, 2, 2]);
  });

  it('rejects pickled object arrays, non-NPY input and truncated files', () => {
    expect(() => parseNpy(read('objects.npy'))).toThrow(/pickle/);
    expect(() => parseNpy(new TextEncoder().encode('id,x\n1,2'))).toThrow(NpyFormatError);
    const truncated = read('f32_c.npy').slice(0, 140);
    expect(() => parseNpy(truncated)).toThrow(/truncated/);
  });
});

describe('NPZ parser', () => {
  it('reads compressed archives with several arrays', () => {
    const entries = parseNpz(read('bundle_compressed.npz'));
    expect(entries.map((e) => e.name)).toEqual(['embeddings', 'labels']);
    expect(entries[0]!.array!.shape).toEqual([5, 3]);
    expect(entries[1]!.array!.data).toEqual({ kind: 'string', values: ['a', 'b', 'a', 'c', 'b'] });
  });

  it('reads stored (uncompressed) archives', () => {
    const entries = parseNpz(read('bundle_stored.npz'));
    expect(entries.find((e) => e.name === 'ids')!.array!.shape).toEqual([5]);
  });

  it('rejects non-zip input', () => {
    expect(() => parseNpz(read('f32_c.npy'))).toThrow(/npz/i);
  });
});
