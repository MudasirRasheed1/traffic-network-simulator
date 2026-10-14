import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { buildRoadGraph } from '../buildRoadGraph.js';
import { buildSimulationNetwork } from '../buildSimulationNetwork.js';
import { buildCityGraph } from '../buildCityGraph.js';
import { bboxAround, haversineM } from '../geo.js';

const LAT0 = 30.73;
const LON0 = 76.78;
const M_PER_DEG_LAT = 111195;
const M_PER_DEG_LON = M_PER_DEG_LAT * Math.cos((LAT0 * Math.PI) / 180);
const DOWNLOAD = bboxAround(LAT0, LON0, 3); // ±1500 m
const AREA = bboxAround(LAT0, LON0, 1); // ±500 m

function osm() {
  const elements = [];
  let nextId = 1;
  const nodeAt = new Map();
  return {
    // Reuses the node at the same spot so crossing roads share it.
    node(x, y) {
      const key = `${x},${y}`;
      if (nodeAt.has(key)) return nodeAt.get(key);
      const id = nextId++;
      elements.push({ type: 'node', id, lat: LAT0 + y / M_PER_DEG_LAT, lon: LON0 + x / M_PER_DEG_LON });
      nodeAt.set(key, id);
      return id;
    },
    way(points, tags = {}) {
      elements.push({ type: 'way', id: 1000 + nextId++, nodes: points.map(([x, y]) => this.node(x, y)), tags: { highway: 'secondary', ...tags } });
    },
    json: () => ({ elements }),
  };
}

const build = (o) => buildCityGraph(buildSimulationNetwork(buildRoadGraph(o.json(), { bbox: DOWNLOAD })), AREA);

describe('city graph', () => {
  it('traces feeder roads out to the previous junction instead of the box edge', () => {
    const o = osm();
    // Main crossing at the centre; cross streets 800 m out on every arm.
    o.way([[-2000, 0], [-800, 0], [0, 0], [800, 0], [2000, 0]]);
    o.way([[0, -2000], [0, -800], [0, 0], [0, 800], [0, 2000]]);
    for (const x of [-800, 800]) o.way([[x, -2000], [x, 0], [x, 2000]], { highway: 'tertiary' });
    for (const y of [-800, 800]) o.way([[-2000, y], [0, y], [2000, y]], { highway: 'tertiary' });
    const city = build(o);
    expect(city.intersections).toHaveLength(1);
    expect(city.intersections[0].armCount).toBe(4);
    expect(city.gateways).toHaveLength(4);
    for (const g of city.gateways) {
      expect(g.placedAt).toBe('junction');
      expect(g.role).toBe('both');
    }
    for (const e of city.edges) expect(e.lengthM).toBeCloseTo(800, -1);
    expect(city.summary.feederEdges).toBe(4);
    expect(city.summary.exitEdges).toBe(4);
  });

  it('skips a junction that is too close and starts the feeder at the next one', () => {
    const o = osm();
    o.way([[-2000, 0], [400, 0], [520, 0], [900, 0], [2000, 0]]);
    for (const x of [-800, 400, 520, 900]) o.way([[x, -2000], [x, 0], [x, 2000]], { highway: 'tertiary' });
    const city = build(o);
    const intersection = city.intersections.find((i) => Math.abs(i.lon - (LON0 + 400 / M_PER_DEG_LON)) < 1e-6);
    expect(intersection).toBeDefined();
    const eastward = city.edges.filter((e) => e.from === intersection.id && e.kind === 'exit' && e.lengthM > 100 && e.coords.at(-1)[1] > LON0 + 450 / M_PER_DEG_LON);
    expect(eastward).toHaveLength(1);
    expect(eastward[0].lengthM).toBeCloseTo(500, -1); // 400 → 900 m, not 400 → 520 m
  });

  it('uses the drawn shape, not just its bounding box', () => {
    const o = osm();
    // Two crossings: one at the centre, one near the north-east corner of the box.
    o.way([[-2000, 0], [0, 0], [2000, 0]]);
    o.way([[0, -2000], [0, 0], [0, 2000]]);
    o.way([[-2000, 400], [400, 400], [2000, 400]]);
    o.way([[400, -2000], [400, 400], [400, 2000]]);
    const toLatLon = ([x, y]) => [LAT0 + y / M_PER_DEG_LAT, LON0 + x / M_PER_DEG_LON];
    // Triangle covering the centre crossing but not the (400, 400) one.
    const polygon = [[-500, -500], [700, -500], [-500, 700]].map(toLatLon); // x + y ≤ 200
    const area = { ...AREA, polygon };
    const city = buildCityGraph(buildSimulationNetwork(buildRoadGraph(o.json(), { bbox: DOWNLOAD })), area);
    expect(city.intersections).toHaveLength(1);
    expect(city.intersections[0].lat).toBeCloseTo(LAT0, 6);
  });

  it('falls back to the download edge when no junction exists in the margin', () => {
    const o = osm();
    o.way([[-2000, 0], [0, 0], [2000, 0]]);
    o.way([[0, -2000], [0, 0], [0, 2000]]);
    const city = build(o);
    expect(city.gateways.every((g) => g.placedAt === 'download-edge')).toBe(true);
    expect(city.warnings.some((w) => w.includes('margin'))).toBe(true);
  });

  it('folds a merge/split point into the road and drops the side road it serves', () => {
    const o = osm();
    // One-way eastbound main road with two signalized crossings.
    o.way([[-2000, 0], [-200, 0], [0, 0], [200, 0], [2000, 0]], { oneway: 'yes' });
    for (const x of [-200, 200]) o.way([[x, -2000], [x, 0], [x, 2000]], { highway: 'tertiary' });
    // One-way side road leaving to the north between them: a pure split.
    o.way([[0, 0], [0, 2000]], { highway: 'tertiary', oneway: 'yes' });
    const city = build(o);
    expect(city.intersections).toHaveLength(2);
    const internal = city.edges.filter((e) => e.kind === 'internal');
    expect(internal).toHaveLength(1);
    expect(internal[0].simLinkIds.length).toBeGreaterThanOrEqual(2); // passes the folded point
    expect(internal[0].lengthM).toBeCloseTo(400, -1);
    // Nothing leads north from the folded point.
    expect(city.gateways.some((g) => g.lat > LAT0 + 1000 / M_PER_DEG_LAT && Math.abs(g.lon - LON0) < 50 / M_PER_DEG_LON)).toBe(false);
  });

  it('drops a road that crosses the area without meeting an intersection', () => {
    const o = osm();
    o.way([[-2000, 0], [2000, 0]]);
    const city = build(o);
    expect(city.intersections).toHaveLength(0);
    expect(city.edges).toHaveLength(0);
    expect(city.warnings.length).toBeGreaterThan(0);
  });
});

describe.each([
  ['chandigarh-sector17', { south: 30.730, west: 76.770, north: 30.748, east: 76.791 }],
  ['delhi-connaught-place', { south: 28.622776, west: 77.209134, north: 28.640763, east: 77.229627 }],
])('city graph on real OSM data (%s)', (file, download) => {
  const data = JSON.parse(readFileSync(new URL(`./fixtures/${file}.json`, import.meta.url)));
  const area = bboxAround((download.south + download.north) / 2, (download.west + download.east) / 2, 1.2);
  const city = buildCityGraph(buildSimulationNetwork(buildRoadGraph(data, { bbox: download })), area);

  it('is a clean graph: intersections with 3–4 arms, every road ends at an intersection', () => {
    expect(city.intersections.length).toBeGreaterThan(0);
    const ids = new Set([...city.intersections.map((i) => i.id), ...city.gateways.map((g) => g.id)]);
    const intersectionIds = new Set(city.intersections.map((i) => i.id));
    for (const e of city.edges) {
      expect(ids.has(e.from) && ids.has(e.to)).toBe(true);
      expect(intersectionIds.has(e.from) || intersectionIds.has(e.to)).toBe(true);
      expect(e.share).toBeGreaterThan(0);
      expect(e.share).toBeLessThanOrEqual(1);
    }
    for (const i of city.intersections) {
      expect(i.armCount).toBeGreaterThanOrEqual(3);
      expect(i.armCount).toBeLessThanOrEqual(4);
      const ins = Object.values(i.arms).flatMap((a) => a.inEdgeIds);
      const outs = Object.values(i.arms).flatMap((a) => a.outEdgeIds);
      expect(ins.length).toBeGreaterThan(0);
      expect(outs.length).toBeGreaterThan(0);
      expect(i.phases.length).toBeGreaterThan(0);
    }
  });

  it('places sources and sinks outside the selected area', () => {
    for (const g of city.gateways) {
      const inside = g.lat > area.south && g.lat < area.north && g.lon > area.west && g.lon < area.east;
      expect(inside).toBe(false);
    }
  });

  it('draws each road once: no source/sink road on top of another road, one road end per arm', () => {
    for (const e of city.edges.filter((x) => x.kind !== 'internal')) {
      const ids = e.simLinkIds.join(',');
      const covered = city.edges.some((f) => f !== e && f.simLinkIds.length > e.simLinkIds.length
        && (e.kind === 'feeder' ? f.to === e.to && f.simLinkIds.join(',').endsWith(ids) : f.from === e.from && f.simLinkIds.join(',').startsWith(ids)));
      expect(covered).toBe(false);
    }
    const gatewayById = new Map(city.gateways.map((g) => [g.id, g]));
    for (const i of city.intersections) {
      for (const a of Object.values(i.arms)) {
        const ends = new Set([...a.inEdgeIds, ...a.outEdgeIds].map((id) => city.edges.find((e) => e.id === id)).map((e) => (e.from === i.id ? e.to : e.from)).filter((id) => gatewayById.has(id)));
        const list = Array.from(ends).map((id) => gatewayById.get(id));
        for (let x = 0; x < list.length; x++) {
          for (let y = x + 1; y < list.length; y++) {
            expect(haversineM(list[x].lat, list[x].lon, list[y].lat, list[y].lon)).toBeGreaterThan(120);
          }
        }
      }
    }
  });
});

describe('city graph on Connaught Place divided roads', () => {
  const data = JSON.parse(readFileSync(new URL('./fixtures/delhi-connaught-place.json', import.meta.url)));
  const download = { south: 28.622776, west: 77.209134, north: 28.640763, east: 77.229627 };
  // The area border cuts Tolstoy Marg between two intersections.
  const area = { south: 28.6263695, north: 28.6371695, west: 77.2131805, east: 77.2255805 };
  const city = buildCityGraph(buildSimulationNetwork(buildRoadGraph(data, { bbox: download })), area);

  const neighbours = (id) => new Set(city.links.filter((l) => l.from === id || l.to === id).map((l) => (l.from === id ? l.to : l.from)));

  it('connects every intersection to one line per real road', () => {
    const extra = city.intersections.filter((i) => neighbours(i.id).size > i.armCount);
    // One exception that is true to the map: eastbound Tolstoy Marg from
    // Janpath does not reach the next roundabout in OSM and ends at a sink.
    expect(extra.map((i) => i.name)).toEqual(['Janpath × Tolstoy Marg']);
    expect(city.summary.overlappingDropped).toBeGreaterThan(0);
    expect(city.summary.gatewaysMerged).toBeGreaterThan(0);
    expect(city.gateways.some((g) => g.role === 'both')).toBe(true);
  });

  it('keeps a road that leaves the area and comes back as one road', () => {
    expect(city.summary.throughRoadsJoined).toBe(1);
    const janpath = city.intersections.find((i) => i.name === 'Janpath × Tolstoy Marg');
    const roundabout = city.intersections.find((i) => i.name === 'Tolstoy Marg × Kasturba Gandhi Marg');
    expect(city.edges.some((e) => e.kind === 'internal' && e.from === roundabout.id && e.to === janpath.id)).toBe(true);
  });

  it('gives a turn lane that skipped an intersection its own arm there', () => {
    // Sansad Marg joins Outer Circle by a free left just past the junction.
    expect(city.summary.turnLanesAbsorbed).toBe(1);
    const ring = city.intersections.find((i) => i.name === 'Outer Circle');
    const lane = Object.values(ring.arms).find((a) => a.turnLane);
    expect(lane.name).toBe('Sansad Marg');
    const turns = ring.movements.filter((m) => m.from === lane.dir);
    expect(turns.filter((m) => m.allowed).map((m) => m.turn)).toEqual(['L']); // only the free left
  });
});
