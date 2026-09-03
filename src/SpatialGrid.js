/**
 * SpatialGrid
 * ------------
 * A minimal uniform-grid spatial index used to answer "how close is point P
 * to the nearest dense splat region?" without looping over every splat
 * every frame (which doesn't scale to millions of points).
 *
 * This is intentionally simple (a hash grid, not an octree/BVH) because:
 *  - Splat clouds are usually roughly uniform in density per local region,
 *    so a fixed-size grid bucket works well and is O(1) to insert/query.
 *  - It's trivial to reason about and explain in a README ("Architectural
 *    Decisions") section — a strong default before reaching for something
 *    fancier like an octree.
 *
 * Swap this out for an octree/BVH if your splat data is very non-uniform
 * in density (e.g. huge empty voids next to ultra-dense clusters), since a
 * uniform grid wastes memory on empty cells in that case.
 */
export class SpatialGrid {
  /**
   * @param {number} cellSize - world-space size of one grid cell
   */
  constructor(cellSize = 0.5) {
    this.cellSize = cellSize;
    this.cells = new Map(); // key: "x,y,z" -> array of [x,y,z] points
  }

  _key(x, y, z) {
    const s = this.cellSize;
    return `${Math.floor(x / s)},${Math.floor(y / s)},${Math.floor(z / s)}`;
  }

  clear() {
    this.cells.clear();
  }

  /**
   * Bulk-insert points. Accepts a Float32Array of interleaved x,y,z triples,
   * which is the layout most splat loaders expose for positions.
   */
  insertPositions(float32Positions) {
    for (let i = 0; i < float32Positions.length; i += 3) {
      const x = float32Positions[i];
      const y = float32Positions[i + 1];
      const z = float32Positions[i + 2];
      const key = this._key(x, y, z);
      let bucket = this.cells.get(key);
      if (!bucket) {
        bucket = [];
        this.cells.set(key, bucket);
      }
      bucket.push(x, y, z);
    }
  }

  /**
   * Returns the squared distance from (x,y,z) to the nearest indexed point,
   * searching the point's own cell plus its 26 neighbors. Returns Infinity
   * if nothing is indexed nearby (caller should clamp/handle that).
   */
  nearestDistanceSq(x, y, z) {
    const s = this.cellSize;
    const cx = Math.floor(x / s);
    const cy = Math.floor(y / s);
    const cz = Math.floor(z / s);

    let best = Infinity;
    for (let dx = -1; dx <= 1; dx++) {
      for (let dy = -1; dy <= 1; dy++) {
        for (let dz = -1; dz <= 1; dz++) {
          const bucket = this.cells.get(`${cx + dx},${cy + dy},${cz + dz}`);
          if (!bucket) continue;
          for (let i = 0; i < bucket.length; i += 3) {
            const ddx = bucket[i] - x;
            const ddy = bucket[i + 1] - y;
            const ddz = bucket[i + 2] - z;
            const distSq = ddx * ddx + ddy * ddy + ddz * ddz;
            if (distSq < best) best = distSq;
          }
        }
      }
    }
    return best;
  }

  nearestDistance(x, y, z) {
    const distSq = this.nearestDistanceSq(x, y, z);
    return Number.isFinite(distSq) ? Math.sqrt(distSq) : Infinity;
  }
}
