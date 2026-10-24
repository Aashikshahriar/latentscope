import { describe, expect, it } from 'vitest';
import { pcaCentered } from '@/algorithms/pca/pca';
import { centerColumns } from '@/algorithms/linalg/matrix';
import { flatten, loadFixture } from './helpers';

interface PcaCase {
  n: number;
  d: number;
  x: number[][];
  explainedVariance: number[];
  explainedVarianceRatio: number[];
  components: number[][];
  scores: number[][];
}

const fixture = loadFixture<{ cases: Record<string, PcaCase> }>('pca');

/** PCA directions are defined up to sign; align each of ours to the reference before comparing. */
function alignSign(ours: number[], ref: number[]): number[] {
  const dot = ours.reduce((s, v, i) => s + v * ref[i]!, 0);
  return dot < 0 ? ours.map((v) => -v) : ours;
}

const methods = [
  'svd',
  'covariance-eigendecomposition',
  'gram-eigendecomposition',
  'randomized-svd',
] as const;

describe('PCA against scikit-learn (svd_solver="full")', () => {
  for (const [name, c] of Object.entries(fixture.cases)) {
    for (const method of methods) {
      it(`${name} (${c.n}×${c.d}) via ${method}`, () => {
        const xc = flatten(c.x);
        centerColumns(xc, c.n, c.d);
        const { scores, diagnostics } = pcaCentered(xc, c.n, c.d, {
          outputDims: 3,
          maxComponents: Math.min(c.n, c.d),
          forceMethod: method,
          seed: 1,
        });
        const tol = method === 'randomized-svd' ? 1e-6 : 1e-8;
        const kCheck = method === 'randomized-svd' ? 3 : c.explainedVariance.length;
        for (let i = 0; i < kCheck; i++) {
          const ref = c.explainedVariance[i]!;
          expect(Math.abs(diagnostics.explainedVariance[i]! - ref)).toBeLessThan(tol * Math.max(1, ref));
          expect(diagnostics.explainedVarianceRatio[i]).toBeCloseTo(c.explainedVarianceRatio[i]!, 6);
        }
        for (let comp = 0; comp < 3; comp++) {
          const ours = alignSign(diagnostics.components[comp]!, c.components[comp]!);
          ours.forEach((v, i) => expect(v).toBeCloseTo(c.components[comp]![i]!, 6));
          // Scores follow the same sign as the aligned direction.
          const flip = ours[0] === diagnostics.components[comp]![0] ? 1 : -1;
          for (let r = 0; r < c.n; r++) {
            expect(flip * scores[r * 3 + comp]!).toBeCloseTo(c.scores[r]![comp]!, 5);
          }
        }
      });
    }
  }

  it('produces orthonormal principal directions', () => {
    const c = fixture.cases.tall!;
    const xc = flatten(c.x);
    centerColumns(xc, c.n, c.d);
    const { diagnostics } = pcaCentered(xc, c.n, c.d, { outputDims: 3, maxComponents: 6 });
    const v = diagnostics.components;
    for (let a = 0; a < v.length; a++) {
      for (let b = 0; b < v.length; b++) {
        const dot = v[a]!.reduce((s, x, i) => s + x * v[b]![i]!, 0);
        expect(dot).toBeCloseTo(a === b ? 1 : 0, 10);
      }
    }
  });

  it('reconstructs the centred data exactly from all components', () => {
    const c = fixture.cases.tall!;
    const xc = flatten(c.x);
    centerColumns(xc, c.n, c.d);
    const { scores, diagnostics } = pcaCentered(xc, c.n, c.d, { outputDims: c.d, maxComponents: c.d });
    for (let i = 0; i < c.n; i++) {
      for (let k = 0; k < c.d; k++) {
        let recon = 0;
        for (let comp = 0; comp < c.d; comp++)
          recon += scores[i * c.d + comp]! * diagnostics.components[comp]![k]!;
        expect(recon).toBeCloseTo(xc[i * c.d + k]!, 8);
      }
    }
  });

  it('explained variance ratios sum to one when all components are kept', () => {
    const c = fixture.cases.iris!;
    const xc = flatten(c.x);
    centerColumns(xc, c.n, c.d);
    const { diagnostics } = pcaCentered(xc, c.n, c.d, { outputDims: 2, maxComponents: 4 });
    expect(diagnostics.explainedVarianceRatio.reduce((s, v) => s + v, 0)).toBeCloseTo(1, 12);
  });

  it('handles rank-deficient input (duplicated observations, constant features)', () => {
    // 5 observations on a line in 3D: rank 1.
    const rows = [0, 1, 2, 3, 4].map((t) => [t, 2 * t, 7]);
    const xc = flatten(rows);
    centerColumns(xc, 5, 3);
    const { scores, diagnostics } = pcaCentered(xc, 5, 3, { outputDims: 3, maxComponents: 3 });
    expect(diagnostics.rank).toBe(1);
    expect(diagnostics.warnings.some((w) => w.includes('rank 1'))).toBe(true);
    for (let i = 0; i < 5; i++) {
      expect(scores[i * 3 + 1]).toBe(0);
      expect(scores[i * 3 + 2]).toBe(0);
      expect(Number.isFinite(scores[i * 3]!)).toBe(true);
    }
  });

  it('handles two observations and identical observations', () => {
    const two = flatten([
      [1, 2, 3],
      [3, 2, 1],
    ]);
    centerColumns(two, 2, 3);
    const res = pcaCentered(two, 2, 3, { outputDims: 2 });
    expect(res.diagnostics.rank).toBe(1);
    const same = flatten([
      [1, 1],
      [1, 1],
      [1, 1],
    ]);
    centerColumns(same, 3, 2);
    const flat = pcaCentered(same, 3, 2, { outputDims: 2 });
    expect(flat.diagnostics.totalVariance).toBe(0);
    expect(Array.from(flat.scores).every((v) => v === 0)).toBe(true);
  });

  it('rejects a single observation', () => {
    expect(() => pcaCentered(new Float64Array([1, 2]), 1, 2, { outputDims: 2 })).toThrow(/two observations/);
  });
});
