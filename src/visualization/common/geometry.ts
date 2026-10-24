import type { Camera } from 'three';
import { Matrix4 } from 'three';

export interface NormalizedPositions {
  /** count × 3 positions in normalised scene units (z = 0 for 2D). */
  positions: Float32Array;
  center: [number, number, number];
  /** Data units per scene unit. */
  scale: number;
  /** Half-extent of each axis in scene units. */
  extent: [number, number, number];
}

/**
 * Centres coordinates on their bounding box and scales the largest half-extent to 1 so that every
 * projection, whatever its units, renders at a comparable size. The mapping is kept so that axes
 * can be labelled in the projection's own units.
 */
export function normalizeCoords(coords: Float32Array, dims: 2 | 3): NormalizedPositions {
  const count = coords.length / dims;
  const min = [Infinity, Infinity, Infinity];
  const max = [-Infinity, -Infinity, -Infinity];
  for (let i = 0; i < count; i++) {
    for (let k = 0; k < dims; k++) {
      const v = coords[i * dims + k]!;
      if (v < min[k]!) min[k] = v;
      if (v > max[k]!) max[k] = v;
    }
  }
  if (count === 0) {
    return { positions: new Float32Array(0), center: [0, 0, 0], scale: 1, extent: [1, 1, 1] };
  }
  const center: [number, number, number] = [0, 0, 0];
  let half = 0;
  for (let k = 0; k < dims; k++) {
    center[k] = (min[k]! + max[k]!) / 2;
    half = Math.max(half, (max[k]! - min[k]!) / 2);
  }
  const scale = half > 0 ? half : 1;
  const positions = new Float32Array(count * 3);
  for (let i = 0; i < count; i++) {
    for (let k = 0; k < dims; k++) positions[i * 3 + k] = (coords[i * dims + k]! - center[k]!) / scale;
  }
  const extent: [number, number, number] = [0, 0, 0];
  for (let k = 0; k < dims; k++) extent[k] = (max[k]! - min[k]!) / 2 / scale;
  return { positions, center, scale, extent };
}

const tmp = new Matrix4();

/**
 * Projects scene positions to CSS-pixel screen coordinates. Output per point: x, y, depth
 * (NDC z; > 1 or < −1 means clipped).
 */
export function projectToScreen(
  positions: Float32Array,
  camera: Camera,
  width: number,
  height: number,
  out?: Float32Array,
): Float32Array {
  const count = positions.length / 3;
  const result = out && out.length === count * 3 ? out : new Float32Array(count * 3);
  camera.updateMatrixWorld();
  tmp.multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse);
  const e = tmp.elements;
  for (let i = 0; i < count; i++) {
    const x = positions[i * 3]!;
    const y = positions[i * 3 + 1]!;
    const z = positions[i * 3 + 2]!;
    const w = e[3]! * x + e[7]! * y + e[11]! * z + e[15]!;
    const nx = (e[0]! * x + e[4]! * y + e[8]! * z + e[12]!) / w;
    const ny = (e[1]! * x + e[5]! * y + e[9]! * z + e[13]!) / w;
    const nz = (e[2]! * x + e[6]! * y + e[10]! * z + e[14]!) / w;
    result[i * 3] = (nx * 0.5 + 0.5) * width;
    result[i * 3 + 1] = (-ny * 0.5 + 0.5) * height;
    result[i * 3 + 2] = nz;
  }
  return result;
}

/** Even–odd rule point-in-polygon test; polygon is a flat [x0, y0, x1, y1, …] array. */
export function pointInPolygon(x: number, y: number, polygon: number[]): boolean {
  let inside = false;
  const n = polygon.length / 2;
  for (let i = 0, j = n - 1; i < n; j = i++) {
    const xi = polygon[i * 2]!;
    const yi = polygon[i * 2 + 1]!;
    const xj = polygon[j * 2]!;
    const yj = polygon[j * 2 + 1]!;
    if (yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}

/** "Nice" tick values (1, 2, 5 × 10ᵏ) covering [min, max]. */
export function niceTicks(min: number, max: number, target = 6): number[] {
  if (!Number.isFinite(min) || !Number.isFinite(max) || max <= min) return [];
  const span = max - min;
  const raw = span / target;
  const mag = 10 ** Math.floor(Math.log10(raw));
  const norm = raw / mag;
  const step = (norm < 1.5 ? 1 : norm < 3 ? 2 : norm < 7 ? 5 : 10) * mag;
  const start = Math.ceil(min / step) * step;
  const ticks: number[] = [];
  for (let v = start; v <= max + step * 1e-9; v += step) ticks.push(Math.abs(v) < step * 1e-9 ? 0 : v);
  return ticks;
}

export function formatTick(v: number, step: number): string {
  const decimals = Math.max(0, -Math.floor(Math.log10(Math.abs(step) || 1)));
  return v.toFixed(Math.min(decimals, 6));
}
