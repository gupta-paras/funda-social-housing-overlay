/**
 * Ultra-Fast Spatial Grid & Bounding Box Index
 * Optimized for low-memory footprint and sub-millisecond bounding box searches.
 */
class SpatialIndex {
  constructor(cellSize = 0.01) {
    this.cellSize = cellSize;
    this.grid = new Map();
    this.items = [];
  }

  load(items) {
    this.items = items;
    this.grid.clear();
    const cellSize = this.cellSize;

    for (let i = 0; i < items.length; i++) {
      const b = items[i].b; // [minLng, minLat, maxLng, maxLat]
      const gx0 = Math.floor(b[0] / cellSize);
      const gy0 = Math.floor(b[1] / cellSize);
      const gx1 = Math.floor(b[2] / cellSize);
      const gy1 = Math.floor(b[3] / cellSize);

      for (let gx = gx0; gx <= gx1; gx++) {
        for (let gy = gy0; gy <= gy1; gy++) {
          const key = `${gx}:${gy}`;
          let cell = this.grid.get(key);
          if (!cell) {
            cell = [];
            this.grid.set(key, cell);
          }
          cell.push(i);
        }
      }
    }
  }

  /**
   * Search all features intersecting the viewport bounding box [minLng, minLat, maxLng, maxLat]
   */
  search(minLng, minLat, maxLng, maxLat) {
    const cellSize = this.cellSize;
    const gx0 = Math.floor(minLng / cellSize);
    const gy0 = Math.floor(minLat / cellSize);
    const gx1 = Math.floor(maxLng / cellSize);
    const gy1 = Math.floor(maxLat / cellSize);

    const visited = new Set();
    const results = [];

    for (let gx = gx0; gx <= gx1; gx++) {
      for (let gy = gy0; gy <= gy1; gy++) {
        const key = `${gx}:${gy}`;
        const cell = this.grid.get(key);
        if (!cell) continue;

        for (let i = 0; i < cell.length; i++) {
          const idx = cell[i];
          if (visited.has(idx)) continue;
          visited.add(idx);

          const item = this.items[idx];
          const b = item.b;
          // Strict bounding box intersection
          if (b[0] <= maxLng && b[2] >= minLng && b[1] <= maxLat && b[3] >= minLat) {
            results.push(item);
          }
        }
      }
    }
    return results;
  }

  /**
   * Find feature under point (lng, lat) for interactive mouse hover tooltip
   */
  findAt(lng, lat) {
    const cellSize = this.cellSize;
    const gx = Math.floor(lng / cellSize);
    const gy = Math.floor(lat / cellSize);
    const key = `${gx}:${gy}`;
    const cell = this.grid.get(key);
    if (!cell) return null;

    for (let i = 0; i < cell.length; i++) {
      const item = this.items[cell[i]];
      const b = item.b;
      if (lng >= b[0] && lng <= b[2] && lat >= b[1] && lat <= b[3]) {
        // Precise polygon test
        if (this._pointInGeometry(lng, lat, item.g)) {
          return item;
        }
      }
    }
    return null;
  }

  _pointInGeometry(x, y, geom) {
    if (!geom) return false;
    if (geom.type === 'Polygon') {
      return this._pointInPolygon(x, y, geom.coordinates);
    }
    if (geom.type === 'MultiPolygon') {
      for (const poly of geom.coordinates) {
        if (this._pointInPolygon(x, y, poly)) return true;
      }
    }
    return false;
  }

  _pointInPolygon(x, y, rings) {
    if (!rings || !rings.length) return false;
    // Check outer ring
    if (!this._rayCast(x, y, rings[0])) return false;
    // Check inner holes
    for (let i = 1; i < rings.length; i++) {
      if (this._rayCast(x, y, rings[i])) return false;
    }
    return true;
  }

  _rayCast(x, y, ring) {
    let inside = false;
    for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
      const xi = ring[i][0], yi = ring[i][1];
      const xj = ring[j][0], yj = ring[j][1];

      const intersect = ((yi > y) !== (yj > y)) &&
        (x < ((xj - xi) * (y - yi)) / (yj - yi) + xi);
      if (intersect) inside = !inside;
    }
    return inside;
  }
}

// Attach to window / global scope
(typeof window !== 'undefined' ? window : global).SpatialIndex = SpatialIndex;
if (typeof module !== 'undefined' && module.exports) {
  module.exports = SpatialIndex;
}
