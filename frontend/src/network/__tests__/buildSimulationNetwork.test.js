import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { buildRoadGraph } from '../buildRoadGraph.js';
import { assignDirections, buildSimulationNetwork } from '../buildSimulationNetwork.js';
import { bboxAround } from '../geo.js';

const LAT0 = 30.73;
const LON0 = 76.78;
const M_PER_DEG_LAT = 111195;
const M_PER_DEG_LON = M_PER_DEG_LAT * Math.cos((LAT0 * Math.PI) / 180);
const AREA = bboxAround(LAT0, LON0, 1); // 1 km square; roads of 600 m cross its edge

function osm() {
  const elements = [];
  let nextId = 1;
  return {
    node(x, y, tags) {
      const id = nextId++;
      elements.push({ type: 'node', id, lat: LAT0 + y / M_PER_DEG_LAT, lon: LON0 + x / M_PER_DEG_LON, ...(tags ? { tags } : {}) });
      return id;
    },
    // Arm from (x0,y0) out along a bearing for `len` metres.
    ray(from, bearingDeg, len, tags = {}) {
      const r = (bearingDeg * Math.PI) / 180;
      const end = this.node(len * Math.sin(r), len * Math.cos(r));
      return this.way([from, end], tags);
    },
    way(nodes, tags = {}) {
      const id = 1000 + nextId++;
      elements.push({ type: 'way', id, nodes, tags: { highway: 'secondary', ...tags } });
      return id;
    },
    json: () => ({ elements }),
  };
}

const build = (o, simOptions = {}) => buildSimulationNetwork(buildRoadGraph(o.json(), { bbox: AREA }), simOptions);
const signalized = (n) => n.intersections.filter((i) => i.control === 'signal');

describe('simulation network: intersections like the grid', () => {
  it('turns a + crossing into one 4-arm signalized intersection with all 8 phases', () => {
    const o = osm();
    const c = o.node(0, 0);
    for (const b of [0, 90, 180, 270]) o.ray(c, b, 600);
    const n = build(o);
    expect(signalized(n)).toHaveLength(1);
    const i = n.intersections[0];
    expect(Object.keys(i.arms).sort()).toEqual(['E', 'N', 'S', 'W']);
    expect(i.movements.filter((m) => m.allowed)).toHaveLength(12);
    expect(i.phases).toHaveLength(8);
    expect(n.summary.entries).toBe(4);
  });

  it('keeps a T-junction as a 3-arm intersection with a missing slot', () => {
    const o = osm();
    const c = o.node(0, 0);
    for (const b of [90, 180, 270]) o.ray(c, b, 600);
    const n = build(o);
    const i = signalized(n)[0];
    expect(i.armCount).toBe(3);
    expect(i.arms.N).toBeUndefined();
    expect(i.phases.length).toBeLessThan(8);
    expect(i.phases.some((p) => p.partial)).toBe(true);
  });

  it('joins arms arriving from the same direction when there are 5', () => {
    const o = osm();
    const c = o.node(0, 0);
    for (const b of [0, 80, 100, 180, 270]) o.ray(c, b, 600);
    const n = build(o);
    const i = n.intersections[0];
    expect(i.armCount).toBe(4);
    expect(i.originalArmCount).toBe(5);
    expect(i.arms.E.joinedArms).toBe(2);
  });

  it('labels a diagonal crossing so opposite roads stay opposite', () => {
    const arms = [45, 135, 225, 315].map((bearing) => ({ bearing }));
    const dirs = assignDirections(arms).map((a) => a.dir);
    const opposite = { N: 'S', S: 'N', E: 'W', W: 'E' };
    expect(opposite[dirs[0]]).toBe(dirs[2]);
    expect(opposite[dirs[1]]).toBe(dirs[3]);
  });

  it('gives a skewed side road the non-through slot', () => {
    // Main road NE–SW with a side road joining at 81° (close to the NE arm).
    const arms = [{ bearing: 54 }, { bearing: 81 }, { bearing: 234 }];
    const [ne, side, sw] = assignDirections(arms).map((a) => a.dir);
    const opposite = { N: 'S', S: 'N', E: 'W', W: 'E' };
    expect(opposite[ne]).toBe(sw);
    expect([ne, sw]).not.toContain(side);
  });

  it('treats a roundabout as one signalized intersection', () => {
    const o = osm();
    const ring = [];
    for (let k = 0; k < 8; k++) {
      const t = (k / 8) * 2 * Math.PI;
      ring.push(o.node(30 * Math.sin(t), 30 * Math.cos(t)));
    }
    o.way([...ring, ring[0]], { junction: 'roundabout' });
    o.ray(ring[0], 0, 600);
    o.ray(ring[2], 90, 600);
    o.ray(ring[4], 180, 600);
    o.ray(ring[6], 270, 600);
    const n = build(o);
    expect(signalized(n)).toHaveLength(1);
    expect(n.intersections[0].originalKind).toBe('roundabout');
    expect(n.intersections[0].armCount).toBe(4);
  });
});

describe('simulation network: simplification', () => {
  it('drops minor streets and joins the main road through the gap they leave', () => {
    const o = osm();
    const a = o.node(-600, 0);
    const m = o.node(0, 0);
    const b = o.node(600, 0);
    o.way([a, m, b]);
    o.way([m, o.node(0, 200)], { highway: 'residential' });
    const n = build(o);
    expect(n.intersections).toHaveLength(0);
    expect(n.corridors).toHaveLength(1);
    expect(n.corridors[0].lengthM).toBeCloseTo(1000, -1); // clipped to the 1 km area
  });

  it('removes main-road dead ends that no traffic passes through', () => {
    const o = osm();
    const c = o.node(0, 0);
    o.ray(c, 90, 600);
    o.ray(c, 270, 600);
    o.ray(c, 0, 150); // stub ending inside the area
    const n = build(o);
    expect(n.intersections).toHaveLength(0);
    expect(n.corridors).toHaveLength(1);
  });

  // Divided E–W road with a side road joining only the north carriageway.
  function dividedRoadWithSideAccess(northCarriagewayHeading) {
    const o = osm();
    const n1 = o.node(0, 10);
    const [west, east] = [o.node(-600, 10), o.node(600, 10)];
    o.way(northCarriagewayHeading === 'east' ? [west, n1, east] : [east, n1, west], { oneway: 'yes' });
    const [sw, se] = [o.node(-600, -10), o.node(600, -10)];
    o.way(northCarriagewayHeading === 'east' ? [se, sw] : [sw, se], { oneway: 'yes' });
    o.way([n1, o.node(0, 600)], { highway: 'tertiary' });
    return build(o).intersections.find((i) => i.armCount === 3);
  }

  it('marks a left-in / left-out access (Indian left-hand traffic) as a merge point, not a signal', () => {
    // Keep-left: the north carriageway carries eastbound traffic.
    const node = dividedRoadWithSideAccess('east');
    expect(node).toBeDefined();
    expect(node.control).toBe('none');
    expect(node.phases).toHaveLength(0);
  });

  it('signalizes a right-in / right-out access, where the two turns cross', () => {
    const node = dividedRoadWithSideAccess('west');
    expect(node.control).toBe('signal');
  });

  it('keeps a minor street only when it is a real shortcut between main junctions', () => {
    const o = osm();
    // Two parallel main roads 100 m apart, linked by main roads only at the far ends.
    const w1 = o.node(-450, 0);
    const e1 = o.node(450, 0);
    const w2 = o.node(-450, 100);
    const e2 = o.node(450, 100);
    const a = o.node(0, 0);
    const b = o.node(0, 100);
    o.way([o.node(-600, 0), w1, a, e1, o.node(600, 0)]);
    o.way([o.node(-600, 100), w2, b, e2, o.node(600, 100)]);
    o.way([w1, w2]);
    o.way([e1, e2]);
    o.way([a, b], { highway: 'residential' }); // 100 m vs 900 m detour
    const withConnectors = build(o, { includeConnectors: true });
    const without = build(o, { includeConnectors: false });
    expect(withConnectors.summary.connectorChains).toBe(1);
    expect(withConnectors.corridors.some((c) => c.connector)).toBe(true);
    expect(without.corridors.some((c) => c.connector)).toBe(false);
  });
});

describe('simulation network on real OSM data (Chandigarh Sector 17)', () => {
  const data = JSON.parse(readFileSync(new URL('./fixtures/chandigarh-sector17.json', import.meta.url)));
  const bbox = { south: 30.730, west: 76.770, north: 30.748, east: 76.791 };
  const net = buildSimulationNetwork(buildRoadGraph(data, { bbox }));

  it('is a consistent directed network', () => {
    const nodeIds = new Set([...net.intersections.map((i) => i.id), ...net.boundaryPoints.map((b) => b.id)]);
    const linkById = new Map(net.links.map((l) => [l.id, l]));
    for (const l of net.links) {
      expect(nodeIds.has(l.from) && nodeIds.has(l.to)).toBe(true);
      expect(l.from).not.toBe(l.to);
      expect(l.lengthM).toBeGreaterThan(0);
    }
    for (const i of net.intersections) {
      expect(i.armCount).toBeLessThanOrEqual(4);
      for (const arm of Object.values(i.arms)) {
        for (const id of arm.inLinkIds) expect(linkById.get(id).to).toBe(i.id);
        for (const id of arm.outLinkIds) expect(linkById.get(id).from).toBe(i.id);
      }
      if (i.control === 'signal') expect(i.phases.length).toBeGreaterThan(0);
    }
  });

  it('lets traffic from every entry reach some exit', () => {
    const out = new Map();
    for (const l of net.links) {
      if (!out.has(l.from)) out.set(l.from, []);
      out.get(l.from).push(l.to);
    }
    const exits = new Set(net.boundaryPoints.filter((b) => b.role !== 'entry').map((b) => b.id));
    for (const entry of net.boundaryPoints.filter((b) => b.role !== 'exit')) {
      const seen = new Set([entry.id]);
      const stack = [entry.id];
      let reached = false;
      while (stack.length && !reached) {
        const cur = stack.pop();
        for (const next of out.get(cur) || []) {
          if (next !== entry.id && exits.has(next)) reached = true;
          if (!seen.has(next)) { seen.add(next); stack.push(next); }
        }
      }
      expect(reached).toBe(true);
    }
  });

  it('reduces hundreds of map junctions to a small set of signalized intersections', () => {
    expect(net.summary.fullGraphJunctions).toBeGreaterThan(300);
    expect(net.summary.signalized).toBeGreaterThanOrEqual(10);
    expect(net.summary.signalized).toBeLessThanOrEqual(25);
    expect(net.summary.fromRoundabouts).toBe(4);
  });
});

describe('simulation network on real OSM data (Connaught Place, New Delhi)', () => {
  const data = JSON.parse(readFileSync(new URL('./fixtures/delhi-connaught-place.json', import.meta.url)));
  const bbox = { south: 28.622776, west: 77.209134, north: 28.640763, east: 77.229627 };
  const graph = buildRoadGraph(data, { bbox });
  const net = buildSimulationNetwork(graph);

  it('keeps the huge Connaught Place rings as ring roads instead of one giant roundabout', () => {
    expect(graph.warnings.some((w) => w.includes('very large roundabout'))).toBe(true);
    const onOuterCircle = net.intersections.filter((i) => i.control === 'signal' && i.name?.includes('Outer Circle'));
    expect(onOuterCircle.length).toBeGreaterThanOrEqual(4);
  });

  it('never gives an intersection more than 4 arms', () => {
    expect(Math.max(...net.intersections.map((i) => i.armCount))).toBeLessThanOrEqual(4);
    expect(net.intersections.some((i) => i.originalArmCount > 4)).toBe(true);
  });
});
