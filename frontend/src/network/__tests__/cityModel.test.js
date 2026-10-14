import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { buildRoadGraph } from '../buildRoadGraph.js';
import { buildSimulationNetwork } from '../buildSimulationNetwork.js';
import { buildCityGraph } from '../buildCityGraph.js';
import { bboxAround } from '../geo.js';
import {
  addLink, addNode, addReverseLink, connectNodes, deleteLink, deleteNode, deriveCity, mergeNodes, moveNode, setContinuation, setNodeKind, setTurnAllowed, splitRoadAt, updateLink,
} from '../cityModel.js';
import { GraphSimulationEngine } from '../../simulation/graphEngine.js';
import { DEFAULT_CITY_SIM_CONFIG, armDepartureRate, effectiveEdge, engineConfig, sourceLinks } from '../../simulation/cityNetwork.js';
import { PolicyRng } from '../../simulation/rng.js';

const LAT = 28.6;
const LON = 77.2;
const at = (x, y) => [LAT + y / 111195, LON + x / (111195 * Math.cos((LAT * Math.PI) / 180))];
const node = (id, kind, x, y, extra = {}) => ({ id, kind, lat: at(x, y)[0], lon: at(x, y)[1], name: null, ...(kind === 'intersection' ? { frameRotation: 0, blockedTurns: [] } : {}), ...extra });
const link = (id, from, to, nodes, lanes = 2, extra = {}) => {
  const a = nodes.find((n) => n.id === from);
  const b = nodes.find((n) => n.id === to);
  const lengthM = Math.round(Math.hypot((a.lat - b.lat) * 111195, (a.lon - b.lon) * 111195 * Math.cos((LAT * Math.PI) / 180)));
  return { id, from, to, fromArm: null, toArm: null, lengthM, name: null, highway: 'secondary', connector: false, lanes: { value: lanes, source: 'user' }, speedKmh: { value: 50, source: 'user' }, coords: [[a.lat, a.lon], [b.lat, b.lon]], next: null, simLinkIds: [], ...extra };
};
const city = (nodes, links) => deriveCity({ area: bboxAround(LAT, LON, 2), model: { nodes, links } });

function run(c, steps = 120, config = {}) {
  const engine = new GraphSimulationEngine(engineConfig(c, { ...DEFAULT_CITY_SIM_CONFIG, simDuration: steps, ...config }, {}, {}));
  engine.init();
  engine.run();
  return engine;
}
const conserves = (engine) => {
  for (const pol of ['fixed', 'greedy']) {
    const gm = engine.globalMetrics[pol];
    gm.enteredTimeSeries.forEach((entered, t) => expect(gm.throughputTimeSeries[t] + gm.vehiclesInNetwork[t]).toBe(entered));
  }
};

describe('city model: a road shared by several routes exists once', () => {
  // Two sources join at a junction, then one common road reaches the intersection.
  const nodes = [
    node('I1', 'intersection', 0, 0),
    node('J1', 'junction', -300, 0),
    node('G1', 'gateway', -700, 0),
    node('G2', 'gateway', -500, 300),
    node('G3', 'gateway', 500, 0),
    node('G4', 'gateway', 0, 500),
    node('G5', 'gateway', 0, -500),
  ];
  const links = [
    link('L1', 'G1', 'J1', nodes),
    link('L2', 'G2', 'J1', nodes, 1),
    link('L3', 'J1', 'I1', nodes, 3),
    link('L4', 'I1', 'G3', nodes),
    link('L5', 'G4', 'I1', nodes),
    link('L6', 'I1', 'G5', nodes),
  ];
  const c = city(nodes, links);

  it('derives one route per way through the junction, all using the common road', () => {
    const intoWest = c.edges.filter((e) => e.to === 'I1' && e.toArm === 'W');
    expect(intoWest.map((e) => e.linkIds)).toEqual([['L1', 'L3'], ['L2', 'L3']]);
    expect(intoWest.every((e) => e.kind === 'feeder')).toBe(true);
    const west = c.intersections[0].arms.W;
    expect(west.inLinkIds).toEqual(['L3']); // one road arrives
    expect(west.inEdgeIds).toHaveLength(2); // two routes use it
  });

  it('counts the lanes of the common road once', () => {
    const rate = armDepartureRate(c.intersections[0], 'W', c, DEFAULT_CITY_SIM_CONFIG, {});
    expect(rate).toBe(3 * DEFAULT_CITY_SIM_CONFIG.departurePerLane);
  });

  it('gives the arms, turns and phases of the intersection from the roads', () => {
    const i = c.intersections[0];
    expect(Object.keys(i.arms).sort()).toEqual(['E', 'N', 'S', 'W']);
    expect(i.movements.filter((m) => m.allowed).map((m) => `${m.from}${m.turn}`).sort()).toEqual(['NL', 'NT', 'WR', 'WT']);
    expect(i.phases.length).toBeGreaterThan(0);
    expect(c.issues).toEqual([]);
  });

  it('does not slow a road down by cutting it into pieces', () => {
    const route = c.edges.find((e) => e.id === 'L1+L3');
    const whole = effectiveEdge(route, c, {}, DEFAULT_CITY_SIM_CONFIG);
    expect(whole.lengthM).toBe(700);
    expect(whole.travelSteps).toBe(Math.ceil(700 / ((50 / 3.6) * 5))); // 11, not ceil(400/69.4) + ceil(300/69.4) = 6 + 5
    expect(whole.linkEnds.map((x) => x.linkId)).toEqual(['L1', 'L3']);
    expect(whole.linkEnds.at(-1).end).toBeCloseTo(whole.travelSteps, 6);
  });

  it('simulates, conserves every car and reports cars per road piece', () => {
    const engine = run(c, 200);
    conserves(engine);
    const snap = engine.getSnapshot();
    for (const pol of ['fixed', 'greedy']) {
      const onLinks = Object.values(snap[pol].links).reduce((a, b) => a + b, 0);
      const onEdges = Object.values(snap[pol].edges).reduce((a, b) => a + b, 0);
      expect(onLinks).toBe(onEdges);
      expect(snap[pol].throughput).toBeGreaterThan(100);
    }
  });
});

describe('city model: a road that splits', () => {
  const nodes = [
    node('I1', 'intersection', 0, 0),
    node('I2', 'intersection', 800, 0),
    node('I3', 'intersection', 400, 500),
    node('J1', 'junction', 400, 0),
    node('G1', 'gateway', -500, 0),
    node('G2', 'gateway', 1300, 0),
    node('G3', 'gateway', 400, 1000),
    node('G4', 'gateway', 0, 500),
    node('G5', 'gateway', 800, 500),
  ];
  const links = [
    link('L1', 'G1', 'J1', nodes),
    link('L2', 'J1', 'I2', nodes, 2),
    link('L3', 'J1', 'I3', nodes, 1),
    link('L4', 'I2', 'G2', nodes),
    link('L5', 'I3', 'G3', nodes),
    link('L6', 'G4', 'I1', nodes),
    link('L7', 'I1', 'J1', nodes),
    link('L8', 'G5', 'I2', nodes),
  ];
  const c = city(nodes, links);

  it('divides traffic by lanes where the road forks', () => {
    const shares = Object.fromEntries(c.edges.filter((e) => e.from === 'G1').map((e) => [e.to, e.share]));
    expect(shares.I2).toBeCloseTo(0.667, 3);
    expect(shares.I3).toBeCloseTo(0.333, 3);
  });

  it('sends each car from a source onto one of its routes in that proportion', () => {
    const engine = run(c, 600);
    const source = sourceLinks(c).find((l) => l.id === 'L1');
    const taken = { I2: 0, I3: 0 };
    for (const step of engine.plannedArrivals) for (const a of step) if (a.entryKey === source.id) taken[engine.edgeById.get(a.edgeId).to] += 1;
    expect(taken.I2 + taken.I3).toBe(600);
    expect(taken.I2 / 600).toBeGreaterThan(0.6);
    expect(taken.I2 / 600).toBeLessThan(0.74);
    conserves(engine);
  });

  it('lets the user forbid one continuation at the junction', () => {
    const edited = deriveCity({ ...c, model: setContinuation(c.model, 'L1', 'L3', false) });
    expect(edited.edges.filter((e) => e.from === 'G1').map((e) => e.to)).toEqual(['I2']);
    // The road from I1 still reaches both.
    expect(edited.edges.filter((e) => e.from === 'I1').map((e) => e.to).sort()).toEqual(['I2', 'I3']);
  });
});

describe('city model: editing', () => {
  const nodes = [
    node('I1', 'intersection', 0, 0),
    node('G1', 'gateway', -500, 0),
    node('G2', 'gateway', 500, 0),
    node('G3', 'gateway', 0, 500),
    node('G4', 'gateway', 0, -500),
  ];
  const links = [
    link('L1', 'G1', 'I1', nodes), link('L2', 'I1', 'G1', nodes),
    link('L3', 'G2', 'I1', nodes), link('L4', 'I1', 'G2', nodes),
    link('L5', 'G3', 'I1', nodes), link('L6', 'I1', 'G3', nodes),
    link('L7', 'G4', 'I1', nodes), link('L8', 'I1', 'G4', nodes),
  ];
  const base = { area: bboxAround(LAT, LON, 2), model: { nodes, links } };
  const derive = (model) => deriveCity({ ...base, model });

  it('adds an intersection and connects it with a two-way road', () => {
    const [lat, lon] = at(500, 500);
    const made = addNode(base.model, 'intersection', lat, lon);
    expect(made.id).toBe('I2');
    const one = addLink(made.model, 'I1', 'I2');
    const two = addLink(one.model, 'I2', 'I1');
    const c = derive(two.model);
    expect(c.intersections).toHaveLength(2);
    const road = c.roads.find((r) => r.id === 'R:I1~I2');
    expect(road.linkIds).toHaveLength(2);
    const added = c.links.find((l) => l.id === one.id);
    expect(added.lengthM).toBeCloseTo(707, -1);
    expect(['N', 'E']).toContain(added.fromArm); // north-east of I1
    // A dead-end intersection is reported, not hidden.
    expect(c.issues.map((x) => x.text)).toEqual(['I2 allows no turn']);
  });

  it('deleting a road direction makes it one-way; adding it back restores it', () => {
    const cut = deleteLink(base.model, 'L2');
    expect(derive(cut).gateways.find((g) => g.id === 'G1').role).toBe('source');
    const back = addReverseLink(cut, 'L1');
    const c = derive(back.model);
    expect(c.gateways.find((g) => g.id === 'G1').role).toBe('both');
    expect(c.links.find((l) => l.id === back.id).fromArm).toBe('W');
  });

  it('connecting two nodes never duplicates a direction and mirrors the one that exists', () => {
    // Make the west road one-way (into I1), curved, and on a hand-picked arm.
    const [bendLat, bendLon] = at(-250, 120);
    const oneWay = {
      ...base.model,
      links: base.model.links
        .filter((l) => l.id !== 'L2')
        .map((l) => (l.id === 'L1' ? { ...l, coords: [l.coords[0], [bendLat, bendLon], l.coords[1]], lengthM: 640, toArm: 'N' } : l)),
    };
    // Asking for a two-way road adds only the missing direction...
    const made = connectNodes(oneWay, 'I1', 'G1', { twoWay: true });
    expect(made.ids).toHaveLength(1);
    const between = made.model.links.filter((l) => [l.from, l.to].sort().join() === 'G1,I1');
    expect(between.map((l) => `${l.from}>${l.to}`).sort()).toEqual(['G1>I1', 'I1>G1']);
    // ...as the mirror of the existing one: same arm, length and shape.
    const added = made.model.links.find((l) => l.id === made.ids[0]);
    expect(added.fromArm).toBe('N');
    expect(added.lengthM).toBe(640);
    expect(added.coords).toEqual(oneWay.links.find((l) => l.id === 'L1').coords.slice().reverse());
    expect(derive(made.model).roads.find((r) => r.id === 'R:G1~I1').linkIds).toHaveLength(2);

    // Asking again changes nothing.
    const again = connectNodes(made.model, 'G1', 'I1', { twoWay: true });
    expect(again.ids).toEqual([]);
    expect(again.model).toBe(made.model);
    // A one-way request in the direction that exists changes nothing either.
    expect(connectNodes(oneWay, 'G1', 'I1', { twoWay: false }).ids).toEqual([]);
    // Between unconnected nodes a two-way road is two directions on one arm at each end.
    const fresh = connectNodes(base.model, 'G1', 'G3', { twoWay: true });
    expect(fresh.ids).toHaveLength(2);
  });

  it('deleting a node removes its roads and reports what is left hanging', () => {
    const c = derive(deleteNode(base.model, 'I1'));
    expect(c.intersections).toHaveLength(0);
    expect(c.links).toHaveLength(0);
    expect(c.issues.filter((x) => /not connected/.test(x.text))).toHaveLength(4);
  });

  it('forbids and re-allows a turn', () => {
    const blocked = derive(setTurnAllowed(base.model, 'I1', 'W', 'E', false));
    expect(blocked.intersections[0].movements.find((m) => m.from === 'W' && m.to === 'E').allowed).toBe(false);
    const again = derive(setTurnAllowed(blocked.model, 'I1', 'W', 'E', true));
    expect(again.intersections[0].movements.find((m) => m.from === 'W' && m.to === 'E').allowed).toBe(true);
  });

  it('removing the signal turns the intersection into a junction that still carries traffic', () => {
    const made = setNodeKind(base.model, 'I1', 'junction');
    expect(made.id).toBe('J1'); // the node is renamed for its new kind
    const c = derive(made.model);
    expect(c.intersections).toHaveLength(0);
    expect(c.junctions).toHaveLength(1);
    expect(c.edges).toHaveLength(0); // source to sink with no intersection: nothing to simulate
    expect(c.issues.some((x) => /without meeting an intersection/.test(x.text))).toBe(true);
    const back = derive(setNodeKind(c.model, 'J1', 'intersection').model);
    expect(back.intersections[0].armCount).toBe(4);
  });

  it('inserts a node into a road, cutting both directions', () => {
    const [lat, lon] = at(-250, 0);
    const made = splitRoadAt(base.model, ['L1', 'L2'], lat, lon, 'junction');
    const c = derive(made.model);
    expect(c.junctions.map((j) => j.id)).toEqual([made.id]);
    expect(c.links.filter((l) => l.from === made.id || l.to === made.id)).toHaveLength(4);
    // The routes are unchanged: still source to intersection and back, same length.
    const feeder = c.edges.find((e) => e.from === 'G1' && e.to === 'I1');
    expect(feeder.linkIds).toHaveLength(2);
    expect(feeder.lengthM).toBeCloseTo(500, -1);
    expect(c.edges.find((e) => e.from === 'I1' && e.to === 'G1').linkIds).toHaveLength(2);
    expect(c.edges.find((e) => e.from === 'G1' && e.to === 'G1')).toBeUndefined(); // no U-turn at the new node
  });

  it('turns the frame of a new intersection to fit diagonal roads', () => {
    // A two-way road running north-east to south-west, the two directions a few metres apart.
    const ns = [node('G1', 'gateway', -400, -400), node('G2', 'gateway', 400, 400)];
    const [aLat, aLon] = at(-394, -406);
    const [bLat, bLon] = at(406, 394);
    const ls = [
      link('L1', 'G1', 'G2', ns),
      { ...link('L2', 'G2', 'G1', ns), coords: [[bLat, bLon], [aLat, aLon]] },
    ];
    const [lat, lon] = at(0, 0);
    const made = splitRoadAt({ nodes: ns, links: ls }, ['L1', 'L2'], lat, lon, 'intersection');
    const c = deriveCity({ area: bboxAround(LAT, LON, 2), model: made.model });
    const i = c.intersections[0];
    expect(i.armCount).toBe(2); // one road passing through, not three arms
    expect(Math.abs(i.frameRotation)).toBeGreaterThan(30);
    const [one, two] = Object.keys(i.arms);
    expect(i.movements.filter((m) => m.allowed).map((m) => `${m.from}>${m.to}:${m.turn}`).sort()).toEqual([`${one}>${two}:T`, `${two}>${one}:T`]);

    // Roads added to an intersection the user made re-fit its frame: a cross of four.
    let model = made.model;
    for (const [x, y] of [[-400, 400], [400, -400]]) {
      const [gLat, gLon] = at(x, y);
      const g = addNode(model, 'gateway', gLat, gLon);
      model = addLink(g.model, g.id, made.id).model;
      model = addLink(model, made.id, g.id).model;
    }
    const cross = deriveCity({ area: bboxAround(LAT, LON, 2), model }).intersections[0];
    expect(cross.armCount).toBe(4);
    expect(cross.movements.filter((m) => m.turn === 'T' && m.allowed)).toHaveLength(4);
  });

  it('merges two nodes that are really one place', () => {
    const [lat, lon] = at(30, 0);
    const made = addNode(base.model, 'intersection', lat, lon);
    // Move the east road onto the twin, and join the twins by a short road.
    let model = updateLink(made.model, 'L3', {});
    model = { ...model, links: model.links.map((l) => (l.id === 'L3' ? { ...l, to: made.id, toArm: null } : l.id === 'L4' ? { ...l, from: made.id, fromArm: null } : l)) };
    model = addLink(model, made.id, 'I1').model;
    model = addLink(model, 'I1', made.id).model;
    expect(derive(model).intersections).toHaveLength(2);
    const merged = derive(mergeNodes(model, 'I1', made.id));
    expect(merged.intersections).toHaveLength(1);
    expect(merged.intersections[0].armCount).toBe(4);
    expect(merged.links).toHaveLength(8); // the short road between the twins is gone
  });

  it('moving a node keeps its roads attached and resizes roads the user drew', () => {
    const [lat, lon] = at(400, 400);
    const made = addNode(base.model, 'junction', lat, lon);
    const linked = addLink(made.model, 'I1', made.id);
    const before = linked.model.links.find((l) => l.id === linked.id).lengthM;
    const [lat2, lon2] = at(800, 800);
    const moved = moveNode(linked.model, made.id, lat2, lon2);
    const l = moved.links.find((x) => x.id === linked.id);
    expect(l.coords.at(-1)).toEqual([lat2, lon2]);
    expect(l.lengthM).toBeCloseTo(before * 2, -1);
  });
});

describe('city model on real data (Connaught Place)', () => {
  const data = JSON.parse(readFileSync(new URL('./fixtures/delhi-connaught-place.json', import.meta.url)));
  const download = { south: 28.622776, west: 77.209134, north: 28.640763, east: 77.229627 };
  const area = bboxAround((download.south + download.north) / 2, (download.west + download.east) / 2, 1.6);
  const c = buildCityGraph(buildSimulationNetwork(buildRoadGraph(data, { bbox: download })), area);

  it('stores every stretch of road once', () => {
    const uses = new Map();
    for (const l of c.links) for (const id of l.simLinkIds) uses.set(id, (uses.get(id) || 0) + 1);
    expect(Math.max(...uses.values())).toBe(1);
    expect(c.junctions.length).toBeGreaterThan(0);
  });

  it('derives routes that are continuous chains of road pieces', () => {
    const linkById = new Map(c.links.map((l) => [l.id, l]));
    const kinds = new Map(c.model.nodes.map((n) => [n.id, n.kind]));
    expect(c.edges.length).toBeGreaterThan(0);
    for (const e of c.edges) {
      const path = e.linkIds.map((id) => linkById.get(id));
      expect(path[0].from).toBe(e.from);
      expect(path.at(-1).to).toBe(e.to);
      for (let k = 0; k + 1 < path.length; k++) {
        expect(path[k].to).toBe(path[k + 1].from);
        expect(kinds.get(path[k].to)).toBe('junction');
      }
    }
  });

  it('survives random edits: the simulator still runs and conserves cars', () => {
    const rng = new PolicyRng('edits');
    const pickFrom = (list) => list[Math.floor(rng.random() * list.length)];
    let model = c.model;
    for (let round = 0; round < 40; round++) {
      const r = rng.random();
      const n = pickFrom(model.nodes);
      const l = pickFrom(model.links);
      if (r < 0.2 && l) model = deleteLink(model, l.id);
      else if (r < 0.3 && n) model = deleteNode(model, n.id);
      else if (r < 0.5 && n) model = addLink(model, n.id, pickFrom(model.nodes).id).model;
      else if (r < 0.6 && n) model = setNodeKind(model, n.id, pickFrom(['intersection', 'junction', 'gateway'])).model;
      else if (r < 0.75 && l) model = splitRoadAt(model, [l.id], l.coords[0][0] + 0.0004, l.coords[0][1] + 0.0004, pickFrom(['intersection', 'junction'])).model;
      else if (r < 0.85 && n) model = mergeNodes(model, n.id, pickFrom(model.nodes).id);
      else if (n) model = addNode(model, pickFrom(['intersection', 'junction', 'gateway']), n.lat + 0.001, n.lon + 0.001).model;
      const edited = deriveCity({ ...c, model });
      if (round % 8 === 7) conserves(run(edited, 60));
    }
  });
});
