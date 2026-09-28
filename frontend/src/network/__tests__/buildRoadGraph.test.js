import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { buildRoadGraph } from '../buildRoadGraph.js';
import { bboxAround } from '../geo.js';

// ---------------------------------------------------------------
// Tiny OSM fixture builder. Coordinates are given in metres
// (x = east, y = north) around a fixed origin.
// ---------------------------------------------------------------
const LAT0 = 30.73;
const LON0 = 76.78;
const M_PER_DEG_LAT = 111195;
const M_PER_DEG_LON = M_PER_DEG_LAT * Math.cos((LAT0 * Math.PI) / 180);

function osm() {
  const elements = [];
  let nextId = 1;
  const api = {
    node(x, y, tags) {
      const id = nextId++;
      elements.push({ type: 'node', id, lat: LAT0 + y / M_PER_DEG_LAT, lon: LON0 + x / M_PER_DEG_LON, ...(tags ? { tags } : {}) });
      return id;
    },
    way(nodes, tags = {}) {
      const id = 1000 + nextId++;
      elements.push({ type: 'way', id, nodes, tags: { highway: 'secondary', ...tags } });
      return id;
    },
    restriction(kind, fromWay, viaNode, toWay) {
      elements.push({
        type: 'relation',
        id: 5000 + nextId++,
        members: [
          { type: 'way', ref: fromWay, role: 'from' },
          { type: 'node', ref: viaNode, role: 'via' },
          { type: 'way', ref: toWay, role: 'to' },
        ],
        tags: { type: 'restriction', restriction: kind },
      });
    },
    json: () => ({ elements }),
  };
  return api;
}

const realJunctions = (g) => g.junctions.filter((j) => !j.isBoundary && j.kind !== 'dead_end' && j.kind !== 'continuation');
const linkOf = (g, id) => g.links.find((l) => l.id === id);

function plusJunction(tags = {}) {
  const o = osm();
  const c = o.node(0, 0);
  const ways = {
    N: o.way([c, o.node(0, 200)], tags),
    E: o.way([c, o.node(200, 0)], tags),
    S: o.way([c, o.node(0, -200)], tags),
    W: o.way([c, o.node(-200, 0)], tags),
  };
  return { o, c, ways };
}

describe('junction detection', () => {
  it('finds a single 4-arm junction at a plus crossing', () => {
    const { o } = plusJunction();
    const g = buildRoadGraph(o.json());
    const js = realJunctions(g);
    expect(js).toHaveLength(1);
    expect(js[0].arms).toHaveLength(4);
    expect(js[0].kind).toBe('priority');
    expect(g.roads).toHaveLength(4);
    expect(g.links).toHaveLength(8);
  });

  it('classifies turns by geometry (right = clockwise)', () => {
    const { o } = plusJunction();
    const g = buildRoadGraph(o.json());
    const j = realJunctions(g)[0];
    const allowed = j.movements.filter((m) => m.allowed);
    expect(allowed).toHaveLength(12); // 4 approaches × (L, T, R)
    expect(j.movements.filter((m) => m.turn === 'U').every((m) => !m.allowed)).toBe(true);

    const armAt = (compass) => j.arms.findIndex((a) => a.compass === compass);
    // Arriving from the south arm (heading north) and leaving on the east arm is a right turn.
    const southToEast = j.movements.find((m) => m.fromArm === armAt('S') && m.toArm === armAt('E'));
    const southToWest = j.movements.find((m) => m.fromArm === armAt('S') && m.toArm === armAt('W'));
    const southToNorth = j.movements.find((m) => m.fromArm === armAt('S') && m.toArm === armAt('N'));
    expect(southToEast.turn).toBe('R');
    expect(southToWest.turn).toBe('L');
    expect(southToNorth.turn).toBe('T');
  });

  it('finds a 3-arm T-junction', () => {
    const o = osm();
    const a = o.node(-200, 0);
    const c = o.node(0, 0);
    const b = o.node(200, 0);
    o.way([a, c, b]);
    o.way([c, o.node(0, -150)]);
    const g = buildRoadGraph(o.json());
    const js = realJunctions(g);
    expect(js).toHaveLength(1);
    expect(js[0].arms).toHaveLength(3);
    expect(js[0].movements.filter((m) => m.allowed)).toHaveLength(6);
  });

  it('does not create junctions along a curved road', () => {
    const o = osm();
    const nodes = [];
    for (let i = 0; i <= 20; i++) {
      const t = (i / 20) * Math.PI;
      nodes.push(o.node(300 * Math.cos(t), 300 * Math.sin(t)));
    }
    o.way(nodes);
    const g = buildRoadGraph(o.json());
    expect(realJunctions(g)).toHaveLength(0);
    expect(g.roads).toHaveLength(1);
    expect(g.roads[0].lengthM).toBeGreaterThan(900); // π × 300 m ≈ 942 m
    expect(g.roads[0].lengthM).toBeLessThan(945);
  });

  it('joins a road split into several OSM ways into one road', () => {
    const o = osm();
    const a = o.node(0, 0);
    const m = o.node(100, 0);
    const b = o.node(200, 0);
    o.way([a, m], { lanes: '2' });
    o.way([m, b], { lanes: '4' });
    const g = buildRoadGraph(o.json());
    expect(g.roads).toHaveLength(1);
    expect(g.roads[0].osmWayIds).toHaveLength(2);
    // Bottleneck lanes: narrowest section (lanes=2 two-way -> 1 per direction).
    expect(linkOf(g, g.roads[0].linkIds[0]).lanes.value).toBe(1);
  });

  it('does not connect roads that cross without a shared node (flyover)', () => {
    const o = osm();
    o.way([o.node(-200, 0), o.node(200, 0)], { bridge: 'yes', layer: '1' });
    o.way([o.node(0, -200), o.node(0, 200)]);
    const g = buildRoadGraph(o.json());
    expect(realJunctions(g)).toHaveLength(0);
    expect(g.roads).toHaveLength(2);
    expect(g.summary.components).toBe(2);
  });
});

describe('junction consolidation', () => {
  // Two divided roads crossing: 4 one-way carriageways, 4 crossing points ~20 m apart.
  function dividedCrossing() {
    const o = osm();
    const nw = o.node(-10, 10);
    const ne = o.node(10, 10);
    const sw = o.node(-10, -10);
    const se = o.node(10, -10);
    // East-west road: north carriageway westbound, south carriageway eastbound.
    o.way([o.node(300, 10), ne, nw, o.node(-300, 10)], { oneway: 'yes' });
    o.way([o.node(-300, -10), sw, se, o.node(300, -10)], { oneway: 'yes' });
    // North-south road: east carriageway northbound, west carriageway southbound.
    o.way([o.node(10, -300), se, ne, o.node(10, 300)], { oneway: 'yes' });
    o.way([o.node(-10, 300), nw, sw, o.node(-10, -300)], { oneway: 'yes' });
    return o;
  }

  it('merges a divided-road crossing into one junction with 4 divided arms', () => {
    const g = buildRoadGraph(dividedCrossing().json());
    const js = realJunctions(g);
    expect(js).toHaveLength(1);
    expect(js[0].osmNodes).toHaveLength(4);
    expect(js[0].arms).toHaveLength(4);
    expect(js[0].arms.every((a) => a.divided)).toBe(true);
  });

  it('keeps the four points separate when merging is disabled', () => {
    const g = buildRoadGraph(dividedCrossing().json(), { mergeDistanceM: 0 });
    expect(realJunctions(g).length).toBe(4);
  });

  it('collapses a roundabout into one junction', () => {
    const o = osm();
    const ring = [];
    for (let i = 0; i < 8; i++) {
      const t = (i / 8) * 2 * Math.PI;
      ring.push(o.node(30 * Math.sin(t), 30 * Math.cos(t)));
    }
    o.way([...ring, ring[0]], { junction: 'roundabout' });
    // Approaches attach at N, E, S, W ring nodes.
    o.way([ring[0], o.node(0, 300)]);
    o.way([ring[2], o.node(300, 0)]);
    o.way([ring[4], o.node(0, -300)]);
    o.way([ring[6], o.node(-300, 0)]);
    const g = buildRoadGraph(o.json());
    const js = realJunctions(g);
    expect(js).toHaveLength(1);
    expect(js[0].kind).toBe('roundabout');
    expect(js[0].arms).toHaveLength(4);
    expect(g.internalGeometry.length).toBeGreaterThan(0);
  });
});

describe('road parameters and their sources', () => {
  it('reads lanes from OSM and splits them across directions', () => {
    const { o } = plusJunction({ lanes: '4' });
    const g = buildRoadGraph(o.json());
    const link = g.links[0];
    expect(link.lanes).toMatchObject({ value: 2, source: 'osm' });
  });

  it('falls back to class defaults and says so', () => {
    const { o } = plusJunction({ highway: 'residential' });
    const g = buildRoadGraph(o.json());
    const link = g.links[0];
    expect(link.lanes).toMatchObject({ value: 1, source: 'default' });
    expect(link.speedKmh).toMatchObject({ value: 25, source: 'default' });
  });

  it('parses maxspeed in mph and derives capacity parameters', () => {
    const o = osm();
    o.way([o.node(0, 0), o.node(360, 0)], { maxspeed: '30 mph', lanes: '2', oneway: 'yes' });
    const g = buildRoadGraph(o.json());
    expect(g.links).toHaveLength(1);
    const link = g.links[0];
    expect(link.speedKmh).toMatchObject({ value: 48, source: 'osm' });
    expect(link.saturationFlowVph).toBe(3600);
    expect(link.storageVeh).toBe(Math.floor((link.lengthM * 2) / 7.5));
    expect(link.freeFlowTimeS).toBeCloseTo(link.lengthM / (48 / 3.6), 0);
  });

  it('respects one-way direction including oneway=-1', () => {
    const o = osm();
    const a = o.node(0, 0);
    const b = o.node(200, 0);
    o.way([a, b], { oneway: '-1' });
    const g = buildRoadGraph(o.json());
    expect(g.links).toHaveLength(1);
    const road = g.roads[0];
    const link = g.links[0];
    expect(link.from).toBe(road.to);
    expect(link.to).toBe(road.from);
  });
});

describe('area clipping and boundary entries', () => {
  it('cuts roads at the area edge and creates entry/exit points', () => {
    const { o } = plusJunction();
    const bbox = bboxAround(LAT0, LON0, 0.2); // 200 m square: arms (200 m) stick out by 100 m
    const g = buildRoadGraph(o.json(), { bbox });
    const entries = g.junctions.filter((j) => j.isBoundary);
    expect(entries).toHaveLength(4);
    expect(entries.every((j) => j.boundaryRole === 'entry_exit')).toBe(true);
    for (const road of g.roads) expect(road.lengthM).toBeCloseTo(100, -1);
    expect(g.summary.entryPoints).toBe(4);
  });
});

describe('traffic signals', () => {
  it('assigns approach-mapped signals to the nearby junction', () => {
    const o = osm();
    const c = o.node(0, 0);
    const sig = o.node(0, -15, { highway: 'traffic_signals' });
    o.way([c, o.node(0, 200)]);
    o.way([c, o.node(200, 0)]);
    o.way([o.node(0, -200), sig, c]);
    o.way([c, o.node(-200, 0)]);
    const g = buildRoadGraph(o.json());
    const j = realJunctions(g)[0];
    expect(j.kind).toBe('signalized');
    expect(j.signal.evidence[0]).toMatchObject({ distanceM: 15 });
  });

  it('treats a far-away signal as a mid-block crossing', () => {
    const o = osm();
    o.way([o.node(0, 0), o.node(250, 0, { highway: 'traffic_signals' }), o.node(500, 0)]);
    const g = buildRoadGraph(o.json());
    expect(g.roads[0].midblockSignals).toHaveLength(1);
    expect(g.junctions.some((j) => j.kind === 'signalized')).toBe(false);
  });
});

describe('turn restrictions', () => {
  it('blocks a movement tagged no_left_turn', () => {
    const { o, c, ways } = plusJunction();
    o.restriction('no_left_turn', ways.S, c, ways.W);
    const g = buildRoadGraph(o.json());
    const j = realJunctions(g)[0];
    const blocked = j.movements.filter((m) => !m.allowed && m.turn !== 'U');
    expect(blocked).toHaveLength(1);
    expect(blocked[0].turn).toBe('L');
    expect(j.restrictions[0].movementsAffected).toBe(1);
  });
});

describe('real OSM extract (Chandigarh Sector 17, 2 km)', () => {
  const data = JSON.parse(readFileSync(new URL('./fixtures/chandigarh-sector17.json', import.meta.url)));
  const bbox = { south: 30.730, west: 76.770, north: 30.748, east: 76.791 };
  const g = buildRoadGraph(data, { bbox });

  it('produces a consistent graph', () => {
    const junctionIds = new Set(g.junctions.map((j) => j.id));
    const linkIds = new Set(g.links.map((l) => l.id));
    for (const road of g.roads) {
      expect(junctionIds.has(road.from) && junctionIds.has(road.to)).toBe(true);
      expect(road.from).not.toBe(road.to);
      expect(road.linkIds.length).toBeGreaterThan(0);
      expect(road.lengthM).toBeGreaterThan(0);
    }
    for (const j of g.junctions) {
      for (const m of j.movements) {
        expect(linkIds.has(m.fromLinkId) && linkIds.has(m.toLinkId)).toBe(true);
        expect(linkOf(g, m.fromLinkId).to).toBe(j.id);
        expect(linkOf(g, m.toLinkId).from).toBe(j.id);
      }
    }
  });

  it('recognises the sector roundabouts and signals', () => {
    expect(g.summary.roundabouts).toBeGreaterThanOrEqual(4);
    expect(g.summary.signalized).toBeGreaterThanOrEqual(3);
    // Every roundabout on the V-roads is a clean 4- or 5-arm junction, not a cloud of points.
    for (const j of g.junctions.filter((x) => x.kind === 'roundabout')) {
      expect(j.arms.length).toBeGreaterThanOrEqual(4);
      expect(j.arms.length).toBeLessThanOrEqual(5);
    }
    expect(Math.max(...realJunctions(g).map((j) => j.arms.length))).toBeLessThanOrEqual(8);
  });

  it('is deterministic', () => {
    const again = buildRoadGraph(data, { bbox });
    expect(JSON.stringify(again)).toBe(JSON.stringify(g));
  });
});
