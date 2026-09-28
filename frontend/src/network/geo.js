// Small-area geometry helpers (areas of a few km, so a local
// equirectangular approximation is accurate to well under 1%).

const EARTH_R = 6371008.8;
const DEG = Math.PI / 180;

export function haversineM(aLat, aLon, bLat, bLon) {
  const dLat = (bLat - aLat) * DEG;
  const dLon = (bLon - aLon) * DEG;
  const s = Math.sin(dLat / 2) ** 2 + Math.cos(aLat * DEG) * Math.cos(bLat * DEG) * Math.sin(dLon / 2) ** 2;
  return 2 * EARTH_R * Math.asin(Math.min(1, Math.sqrt(s)));
}

// Compass bearing in degrees [0, 360): 0 = north, 90 = east.
export function bearingDeg(aLat, aLon, bLat, bLon) {
  const y = Math.sin((bLon - aLon) * DEG) * Math.cos(bLat * DEG);
  const x = Math.cos(aLat * DEG) * Math.sin(bLat * DEG)
    - Math.sin(aLat * DEG) * Math.cos(bLat * DEG) * Math.cos((bLon - aLon) * DEG);
  return (Math.atan2(y, x) / DEG + 360) % 360;
}

// Signed difference b - a normalised to (-180, 180]. Positive = clockwise.
export function angleDiff(a, b) {
  let d = ((b - a) % 360 + 360) % 360;
  if (d > 180) d -= 360;
  return d;
}

export function compassLabel(bearing) {
  const labels = ['N', 'NE', 'E', 'SE', 'S', 'SW', 'W', 'NW'];
  return labels[Math.round(bearing / 45) % 8];
}

export function polylineLengthM(coords) {
  let total = 0;
  for (let i = 1; i < coords.length; i++) {
    total += haversineM(coords[i - 1][0], coords[i - 1][1], coords[i][0], coords[i][1]);
  }
  return total;
}

// Point reached after walking `distM` along the polyline (clamped to its end).
export function pointAlong(coords, distM) {
  let walked = 0;
  for (let i = 1; i < coords.length; i++) {
    const [aLat, aLon] = coords[i - 1];
    const [bLat, bLon] = coords[i];
    const seg = haversineM(aLat, aLon, bLat, bLon);
    if (walked + seg >= distM && seg > 0) {
      const t = (distM - walked) / seg;
      return [aLat + (bLat - aLat) * t, aLon + (bLon - aLon) * t];
    }
    walked += seg;
  }
  return coords[coords.length - 1];
}

// Liang–Barsky clip of segment a->b against an axis-aligned lat/lon box.
// Returns [t0, t1] (0..1 along the segment) or null when fully outside.
export function clipSegmentToBox(a, b, box) {
  const dx = b.lon - a.lon;
  const dy = b.lat - a.lat;
  const p = [-dx, dx, -dy, dy];
  const q = [a.lon - box.west, box.east - a.lon, a.lat - box.south, box.north - a.lat];
  let t0 = 0;
  let t1 = 1;
  for (let i = 0; i < 4; i++) {
    if (p[i] === 0) {
      if (q[i] < 0) return null;
    } else {
      const r = q[i] / p[i];
      if (p[i] < 0) {
        if (r > t1) return null;
        if (r > t0) t0 = r;
      } else {
        if (r < t0) return null;
        if (r < t1) t1 = r;
      }
    }
  }
  return [t0, t1];
}

export function bboxAround(lat, lon, sizeKm) {
  const halfLat = (sizeKm * 1000) / 2 / (EARTH_R * DEG);
  const halfLon = halfLat / Math.cos(lat * DEG);
  return { south: lat - halfLat, north: lat + halfLat, west: lon - halfLon, east: lon + halfLon };
}

// Grow a box by `marginM` metres on every side.
export function expandBox(box, marginM) {
  const dLat = marginM / (EARTH_R * DEG);
  const midLat = (box.south + box.north) / 2;
  const dLon = dLat / Math.cos(midLat * DEG);
  return { south: box.south - dLat, north: box.north + dLat, west: box.west - dLon, east: box.east + dLon };
}

// Width / height of a box in kilometres.
export function boxSizeKm(box) {
  const midLat = (box.south + box.north) / 2;
  return {
    widthKm: haversineM(midLat, box.west, midLat, box.east) / 1000,
    heightKm: haversineM(box.south, box.west, box.north, box.west) / 1000,
  };
}

// ---- Polygon areas (arrays of [lat, lon]) -----------------------------

export function polygonBBox(points) {
  const lats = points.map((p) => p[0]);
  const lons = points.map((p) => p[1]);
  return { south: Math.min(...lats), north: Math.max(...lats), west: Math.min(...lons), east: Math.max(...lons) };
}

export function boxToPolygon(box) {
  return [[box.north, box.west], [box.north, box.east], [box.south, box.east], [box.south, box.west]];
}

// Ray casting; works for any simple (non-self-crossing) shape.
export function pointInPolygon(lat, lon, points) {
  let inside = false;
  for (let i = 0, j = points.length - 1; i < points.length; j = i++) {
    const [yi, xi] = points[i];
    const [yj, xj] = points[j];
    if ((yi > lat) !== (yj > lat) && lon < ((xj - xi) * (lat - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}

export function polygonAreaKm2(points) {
  if (points.length < 3) return 0;
  const lat0 = points.reduce((s, p) => s + p[0], 0) / points.length;
  const mPerDegLat = EARTH_R * DEG;
  const mPerDegLon = mPerDegLat * Math.cos(lat0 * DEG);
  let sum = 0;
  for (let i = 0, j = points.length - 1; i < points.length; j = i++) {
    sum += (points[j][1] * mPerDegLon) * (points[i][0] * mPerDegLat) - (points[i][1] * mPerDegLon) * (points[j][0] * mPerDegLat);
  }
  return Math.abs(sum) / 2 / 1e6;
}

// An area: { south, west, north, east, polygon? } — polygon optional.
export function isInsideArea(area, lat, lon) {
  if (lat < area.south || lat > area.north || lon < area.west || lon > area.east) return false;
  return area.polygon?.length >= 3 ? pointInPolygon(lat, lon, area.polygon) : true;
}
