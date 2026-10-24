/**
 * Space-partitioning tree (quadtree in 2D, octree in 3D) for Barnes–Hut t-SNE.
 *
 * Nodes are stored in flat typed arrays for speed and rebuilt every iteration. Each leaf holds
 * at most one distinct location; exact duplicates are aggregated into the leaf's mass.
 */
export class SpaceTree {
  readonly dims: number;
  private readonly branching: number;
  private capacity = 0;
  count = 0;
  // Per-node fields
  center!: Float64Array; // node centre (dims per node)
  halfWidth!: Float64Array; // half-widths (dims per node)
  com!: Float64Array; // centre of mass (dims per node)
  mass!: Int32Array; // number of points in subtree
  firstChild!: Int32Array; // index of first child, −1 for leaves
  point!: Int32Array; // representative point index for leaves, −1 if empty
  maxWidthSq!: Float64Array; // squared largest full width of the cell

  constructor(dims: 2 | 3, expectedPoints: number) {
    this.dims = dims;
    this.branching = 1 << dims;
    this.allocate(Math.max(16, expectedPoints * 2));
  }

  private allocate(capacity: number): void {
    const grow = <T extends Float64Array | Int32Array>(
      old: T | undefined,
      size: number,
      make: (s: number) => T,
    ): T => {
      const next = make(size);
      if (old) next.set(old.subarray(0, Math.min(old.length, size)));
      return next;
    };
    const d = this.dims;
    this.center = grow(this.center, capacity * d, (s) => new Float64Array(s));
    this.halfWidth = grow(this.halfWidth, capacity * d, (s) => new Float64Array(s));
    this.com = grow(this.com, capacity * d, (s) => new Float64Array(s));
    this.mass = grow(this.mass, capacity, (s) => new Int32Array(s));
    this.firstChild = grow(this.firstChild, capacity, (s) => new Int32Array(s));
    this.point = grow(this.point, capacity, (s) => new Int32Array(s));
    this.maxWidthSq = grow(this.maxWidthSq, capacity, (s) => new Float64Array(s));
    this.capacity = capacity;
  }

  private newNode(center: ArrayLike<number>, half: ArrayLike<number>): number {
    if (this.count >= this.capacity) this.allocate(this.capacity * 2);
    const id = this.count++;
    const d = this.dims;
    let maxW = 0;
    for (let k = 0; k < d; k++) {
      this.center[id * d + k] = center[k]!;
      this.halfWidth[id * d + k] = half[k]!;
      this.com[id * d + k] = 0;
      maxW = Math.max(maxW, 2 * half[k]!);
    }
    this.mass[id] = 0;
    this.firstChild[id] = -1;
    this.point[id] = -1;
    this.maxWidthSq[id] = maxW * maxW;
    return id;
  }

  build(y: Float64Array, n: number): void {
    const d = this.dims;
    this.count = 0;
    const min = new Float64Array(d).fill(Infinity);
    const max = new Float64Array(d).fill(-Infinity);
    for (let i = 0; i < n; i++) {
      for (let k = 0; k < d; k++) {
        const v = y[i * d + k]!;
        if (v < min[k]!) min[k] = v;
        if (v > max[k]!) max[k] = v;
      }
    }
    const center = new Float64Array(d);
    const half = new Float64Array(d);
    for (let k = 0; k < d; k++) {
      center[k] = (min[k]! + max[k]!) / 2;
      half[k] = Math.max((max[k]! - min[k]!) / 2, 1e-5) * (1 + 1e-5);
    }
    this.newNode(center, half);
    for (let i = 0; i < n; i++) this.insert(0, i, y, 0);
  }

  private childIndexFor(node: number, y: Float64Array, i: number): number {
    const d = this.dims;
    let idx = 0;
    for (let k = 0; k < d; k++) if (y[i * d + k]! > this.center[node * d + k]!) idx |= 1 << k;
    return idx;
  }

  private subdivide(node: number): void {
    const d = this.dims;
    const first = this.count;
    const c = new Float64Array(d);
    const h = new Float64Array(d);
    for (let child = 0; child < this.branching; child++) {
      for (let k = 0; k < d; k++) {
        const hw = this.halfWidth[node * d + k]! / 2;
        h[k] = hw;
        c[k] = this.center[node * d + k]! + ((child >> k) & 1 ? hw : -hw);
      }
      this.newNode(c, h);
    }
    this.firstChild[node] = first;
  }

  private insert(root: number, i: number, y: Float64Array, startDepth: number): void {
    const d = this.dims;
    let node = root;
    let depth = startDepth;
    for (;;) {
      // Update centre of mass incrementally.
      const m = this.mass[node]!;
      for (let k = 0; k < d; k++) {
        this.com[node * d + k] = (this.com[node * d + k]! * m + y[i * d + k]!) / (m + 1);
      }
      this.mass[node] = m + 1;

      if (this.firstChild[node] === -1) {
        const existing = this.point[node]!;
        if (existing === -1) {
          this.point[node] = i;
          return;
        }
        let duplicate = true;
        for (let k = 0; k < d; k++) if (y[existing * d + k] !== y[i * d + k]) duplicate = false;
        if (duplicate || depth > 48) return; // aggregate identical locations in this leaf
        // Split: push the existing point down, then continue inserting i.
        this.subdivide(node);
        this.point[node] = -1;
        const existingChild = this.firstChild[node]! + this.childIndexFor(node, y, existing);
        const em = this.mass[node]! - 1; // mass of points other than i in this leaf (all at `existing`)
        this.mass[existingChild] = em;
        this.point[existingChild] = existing;
        for (let k = 0; k < d; k++) this.com[existingChild * d + k] = y[existing * d + k]!;
      }
      node = this.firstChild[node]! + this.childIndexFor(node, y, i);
      depth++;
    }
  }

  /**
   * Accumulates the repulsive force on point i into `force` (unnormalised) and returns its
   * contribution to Z = Σ_{k≠l} (1 + ‖y_k − y_l‖²)⁻¹.
   */
  computeNonEdgeForces(
    i: number,
    y: Float64Array,
    thetaSq: number,
    force: Float64Array,
    stack: Int32Array,
  ): number {
    const d = this.dims;
    let sumQ = 0;
    for (let k = 0; k < d; k++) force[k] = 0;
    let top = 0;
    stack[top++] = 0;
    while (top > 0) {
      const node = stack[--top]!;
      const mass = this.mass[node]!;
      if (mass === 0) continue;
      const isLeaf = this.firstChild[node] === -1;
      let distSq = 0;
      for (let k = 0; k < d; k++) {
        const diff = y[i * d + k]! - this.com[node * d + k]!;
        distSq += diff * diff;
      }
      if (isLeaf && (this.point[node] === i || distSq === 0)) {
        // A leaf at exactly y_i contains i itself plus any exact duplicates of it. The duplicates
        // contribute q = 1 each and no force; i must not interact with itself.
        sumQ += mass - 1;
        continue;
      }
      if (isLeaf || this.maxWidthSq[node]! < thetaSq * distSq) {
        const q = 1 / (1 + distSq);
        const mult = mass * q;
        sumQ += mult;
        const fm = mult * q;
        for (let k = 0; k < d; k++) force[k]! += fm * (y[i * d + k]! - this.com[node * d + k]!);
      } else {
        const first = this.firstChild[node]!;
        for (let c = 0; c < this.branching; c++) stack[top++] = first + c;
      }
    }
    return sumQ;
  }
}
