/**
 * Deterministic pseudo-random number generation.
 *
 * All stochastic algorithms in LatentScope take an explicit integer seed and draw from these
 * generators, so a run is reproducible given (dataset, parameters, seed, software version).
 * Mulberry32 is a small, fast 32-bit generator with good statistical quality for simulation
 * purposes (it is not cryptographically secure). Seeds are first mixed with SplitMix32 so that
 * nearby seeds (1, 2, 3…) produce unrelated streams.
 */

export type Rng = () => number;

function splitmix32(seed: number): number {
  let z = (seed + 0x9e3779b9) | 0;
  z = Math.imul(z ^ (z >>> 16), 0x85ebca6b);
  z = Math.imul(z ^ (z >>> 13), 0xc2b2ae35);
  return (z ^ (z >>> 16)) >>> 0;
}

/** Returns a generator of uniform floats in [0, 1). */
export function createRng(seed: number): Rng {
  let state = splitmix32(Math.trunc(seed));
  return () => {
    state = (state + 0x6d2b79f5) | 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Standard normal sampler using the Box–Muller transform (caches the second variate). */
export function createGaussian(rng: Rng): () => number {
  let spare: number | null = null;
  return () => {
    if (spare !== null) {
      const value = spare;
      spare = null;
      return value;
    }
    let u = 0;
    while (u === 0) u = rng();
    const v = rng();
    const radius = Math.sqrt(-2 * Math.log(u));
    spare = radius * Math.sin(2 * Math.PI * v);
    return radius * Math.cos(2 * Math.PI * v);
  };
}

/** Uniform integer in [0, n). */
export function randomInt(rng: Rng, n: number): number {
  return Math.floor(rng() * n);
}

/** Fisher–Yates shuffle in place. */
export function shuffleInPlace<T>(array: T[] | Uint32Array, rng: Rng): void {
  for (let i = array.length - 1; i > 0; i--) {
    const j = randomInt(rng, i + 1);
    const tmp = array[i]!;
    array[i] = array[j]!;
    array[j] = tmp;
  }
}

/**
 * Draws `k` distinct indices from [0, n) without replacement and returns them sorted ascending.
 * Uses a partial Fisher–Yates shuffle when k is a large fraction of n, and rejection sampling
 * with a set otherwise.
 */
export function sampleWithoutReplacement(n: number, k: number, rng: Rng): Uint32Array {
  if (k > n) throw new RangeError(`Cannot sample ${k} items from ${n} without replacement.`);
  let out: Uint32Array;
  if (k > n / 4) {
    const pool = new Uint32Array(n);
    for (let i = 0; i < n; i++) pool[i] = i;
    for (let i = 0; i < k; i++) {
      const j = i + randomInt(rng, n - i);
      const tmp = pool[i]!;
      pool[i] = pool[j]!;
      pool[j] = tmp;
    }
    out = pool.slice(0, k);
  } else {
    const chosen = new Set<number>();
    while (chosen.size < k) chosen.add(randomInt(rng, n));
    out = Uint32Array.from(chosen);
  }
  return out.sort();
}
