import { MODEL_CONSTANTS, ROAD_CLASSES, SOURCES } from '../../network/roadDefaults.js';
import { PHASES } from '../../simulation/constants.js';
import { SourceBadge } from './Inspector.jsx';
import { CITY_COLORS, gatewayColors } from './scenes.js';
import { formatDuration, formatLength } from './networkStyle.js';
import styles from './NetworkExplorer.module.css';

const TURN_LABEL = { L: 'Left (free)', T: 'Through', R: 'Right' };
const DIR_NAME = { N: 'North', E: 'East', S: 'South', W: 'West' };
const EDGE_KIND = {
  internal: { label: 'Road', color: CITY_COLORS.road },
  feeder: { label: 'Feeder road — brings traffic in', color: CITY_COLORS.feeder },
  exit: { label: 'Exit road — takes traffic out', color: CITY_COLORS.exit },
};

function Fact({ label, value }) {
  return (
    <div className={styles.fact}>
      <span>{label}</span>
      <strong>{value}</strong>
    </div>
  );
}

function Param({ label, value, source, detail }) {
  return (
    <div className={styles.param}>
      <div className={styles.paramHead}>
        <span className={styles.paramLabel}>{label}</span>
        <span className={styles.paramValue}>{value}</span>
        <SourceBadge source={source} />
      </div>
      {detail && <div className={styles.paramDetail}>{detail}</div>}
    </div>
  );
}

function NodeChip({ id, lookups, onSelect }) {
  const node = lookups.nodeById(id);
  if (!node) return null;
  const gateway = lookups.gatewayById.has(id);
  const color = gateway ? gatewayColors(node.role).fill : CITY_COLORS.intersection;
  return (
    <button type="button" className={styles.junctionChip} onClick={() => onSelect({ type: gateway ? 'gateway' : 'intersection', id })}>
      <span style={{ background: color, borderRadius: gateway ? 2 : '50%' }} />
      {id}
    </button>
  );
}

// The intersection drawn the way the grid simulator sees it.
export function GridDiagram({ intersection }) {
  const slots = {
    N: { road: 'M150 44 V 97', name: [150, 16, 'middle'], lanes: [150, 32, 'middle'] },
    S: { road: 'M150 145 V 198', name: [150, 222, 'middle'], lanes: [150, 210, 'middle'] },
    E: { road: 'M174 121 H 226', name: [292, 112, 'end'], lanes: [292, 136, 'end'] },
    W: { road: 'M74 121 H 126', name: [8, 112, 'start'], lanes: [8, 136, 'start'] },
  };
  return (
    <svg viewBox="0 0 300 230" className={styles.gridDiagram} role="img" aria-label="Intersection in grid form">
      {Object.entries(slots).map(([dir, s]) => {
        const arm = intersection.arms[dir];
        return (
          <g key={dir} className={arm ? styles.diagArm : styles.diagArmMissing}>
            <path d={s.road} />
            <text x={s.name[0]} y={s.name[1]} textAnchor={s.name[2]} className={styles.diagName}>
              {arm ? (arm.name || 'Unnamed').slice(0, dir === 'N' || dir === 'S' ? 30 : 12) : 'no road'}
            </text>
            {arm && (
              <text x={s.lanes[0]} y={s.lanes[1]} textAnchor={s.lanes[2]} className={styles.diagLanes}>
                in {arm.inLanes} · out {arm.outLanes}
              </text>
            )}
          </g>
        );
      })}
      <rect x="126" y="97" width="48" height="48" rx="8" className={styles.diagBox} />
      {['N', 'E', 'S', 'W'].map((dir) => {
        const p = { N: [150, 111], S: [150, 139], E: [163, 125], W: [137, 125] }[dir];
        return (
          <text key={dir} x={p[0]} y={p[1]} textAnchor="middle" className={intersection.arms[dir] ? styles.diagDir : styles.diagDirMissing}>{dir}</text>
        );
      })}
    </svg>
  );
}

function IntersectionInspector({ intersection: i, lookups, onSelect }) {
  const roundabout = i.originalKind === 'roundabout';
  const phaseByName = new Map(i.phases.map((p) => [p.name, p]));
  const arms = ['N', 'E', 'S', 'W'].filter((d) => i.arms[d]);
  const otherEnd = (edgeId, self) => {
    const e = lookups.edgeById.get(edgeId);
    return e.from === self ? e.to : e.from;
  };

  return (
    <>
      <div className={styles.inspectorHead}>
        <span className={styles.kindBadge} style={{ '--badge': CITY_COLORS.intersection }}>
          {roundabout ? 'Roundabout → signalized intersection' : `${i.armCount}-arm signalized intersection`}
        </span>
        <h3>{i.name || 'Unnamed intersection'}</h3>
        <div className={styles.inspectorSub}>
          <code>{i.id}</code> · {i.lat.toFixed(5)}, {i.lon.toFixed(5)} ·{' '}
          <a href={`https://www.openstreetmap.org/?mlat=${i.lat}&mlon=${i.lon}#map=18/${i.lat}/${i.lon}`} target="_blank" rel="noreferrer">open in OSM ↗</a>
        </div>
      </div>

      <section className={styles.inspectorSection}>
        <GridDiagram intersection={i} />
        <p className={styles.paramDetail}>
          How the simulator sees it: arms in grid slots N/E/S/W
          {i.frameRotation ? ` (frame turned ${Math.abs(i.frameRotation)}° ${i.frameRotation > 0 ? 'clockwise' : 'anticlockwise'} to fit the real roads)` : ''}.
          {i.armCount === 3 ? ' One slot is empty — a T-junction, modelled as is.' : ''}
          {i.originalArmCount > 4 ? ` The real junction has ${i.originalArmCount} arms; arms from the same direction were joined.` : ''}
        </p>
      </section>

      <section className={styles.inspectorSection}>
        <h4>Arms and where they lead</h4>
        <table className={styles.table}>
          <thead><tr><th>Slot</th><th>Road</th><th>Comes from</th><th>Goes to</th></tr></thead>
          <tbody>
            {arms.map((dir) => {
              const a = i.arms[dir];
              return (
                <tr key={dir}>
                  <td><strong>{dir}</strong><div className={styles.muted}>{a.compass}</div></td>
                  <td>
                    <div>{a.name || <span className={styles.muted}>Unnamed</span>}</div>
                    {a.highway && <span className={styles.classChip} style={{ '--chip': ROAD_CLASSES[a.highway]?.color }}>{ROAD_CLASSES[a.highway]?.label}</span>}
                    {a.joinedArms > 1 && <span className={styles.tag}>{a.joinedArms} arms joined</span>}
                  </td>
                  <td>{a.inEdgeIds.length ? a.inEdgeIds.map((id) => <NodeChip key={id} id={otherEnd(id, i.id)} lookups={lookups} onSelect={onSelect} />) : <span className={styles.muted}>—</span>}</td>
                  <td>{a.outEdgeIds.length ? a.outEdgeIds.map((id) => <NodeChip key={id} id={otherEnd(id, i.id)} lookups={lookups} onSelect={onSelect} />) : <span className={styles.muted}>—</span>}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </section>

      <section className={styles.inspectorSection}>
        <h4>Movements <span className={styles.muted}>(same rules as the grid)</span></h4>
        <div className={styles.movementGrid}>
          {arms.filter((d) => i.arms[d].inEdgeIds.length).map((from) => (
            <div key={from} className={styles.movementRow}>
              <span className={styles.movementFrom}>From {from}</span>
              {['L', 'T', 'R'].map((turn) => {
                const m = i.movements.find((x) => x.from === from && x.turn === turn);
                if (!m) return <span key={turn} className={styles.moveNone} title="No road in that direction">{turn}</span>;
                return (
                  <span key={turn} className={m.allowed ? styles[`move${turn}`] : styles.moveBlocked} title={`${TURN_LABEL[turn]} → ${DIR_NAME[m.to]} arm${m.allowed ? '' : ` — blocked: ${m.reason}`}`}>
                    {turn} → {m.to}
                  </span>
                );
              })}
            </div>
          ))}
        </div>
      </section>

      <section className={styles.inspectorSection}>
        <h4>Signal phases <span className={styles.muted}>({i.phases.length} of 8 grid phases usable)</span></h4>
        <div className={styles.phaseGrid}>
          {Object.keys(PHASES).map((name) => {
            const p = phaseByName.get(name);
            return (
              <span
                key={name}
                className={!p ? styles.phaseOff : p.partial ? styles.phasePartial : styles.phaseOn}
                title={!p ? 'No movement of this phase exists here' : `Serves ${p.served.join(', ')}${p.partial ? ' (partly)' : ''}`}
              >
                {name}
              </span>
            );
          })}
        </div>
        <p className={styles.paramDetail}>Same 8 phases as the grid simulator. Left turns are free.</p>
      </section>

      <section className={styles.inspectorSection}>
        <Param
          label="Signal in OpenStreetMap"
          value={i.osmSignal ? 'Tagged' : 'Not tagged'}
          source={i.osmSignal ? SOURCES.OSM : SOURCES.DEFAULT}
          detail="Information only — every intersection in this graph is signal-controlled, identically for Fixed and your policy"
        />
      </section>
    </>
  );
}

function EdgeCard({ edge, lookups, onSelect }) {
  const kind = EDGE_KIND[edge.kind];
  const { saturationFlowPerLaneVph, jamSpacingM } = MODEL_CONSTANTS;
  const folded = edge.simLinkIds.length - 1;
  return (
    <div className={styles.directionCard}>
      <div className={styles.directionHead}>
        <NodeChip id={edge.from} lookups={lookups} onSelect={onSelect} />
        {edge.fromArm && <span className={styles.muted}>{edge.fromArm} arm</span>}
        <span className={styles.directionArrow}>→</span>
        <NodeChip id={edge.to} lookups={lookups} onSelect={onSelect} />
        {edge.toArm && <span className={styles.muted}>{edge.toArm} arm</span>}
        <code className={styles.linkId}>{edge.id}</code>
      </div>
      <span className={styles.kindBadge} style={{ '--badge': kind.color }}>{kind.label}</span>
      <Param label="Length" value={formatLength(edge.lengthM)} source={SOURCES.DERIVED} detail="Measured along the real road" />
      <Param label="Lanes" value={edge.lanes.value} source={edge.lanes.source} detail={edge.lanes.detail} />
      <Param label="Speed limit" value={`${edge.speedKmh.value} km/h`} source={edge.speedKmh.source} detail={edge.speedKmh.detail} />
      <Param label="Free-flow travel time" value={formatDuration(edge.freeFlowTimeS)} source={SOURCES.DERIVED} detail="Sum over the road pieces: length ÷ speed" />
      <Param label="Saturation flow" value={`${edge.saturationFlowVph.toLocaleString()} veh/h`} source={SOURCES.DERIVED} detail={`${edge.lanes.value} lane(s) × ${saturationFlowPerLaneVph} veh/h/lane`} />
      <Param label="Queue storage" value={`${edge.storageVeh} vehicles`} source={SOURCES.DERIVED} detail={`${Math.round(edge.lengthM)} m × ${edge.lanes.value} lane(s) ÷ ${jamSpacingM} m`} />
      {edge.share < 1 && (
        <Param
          label="Share of the arm's traffic"
          value={`${Math.round(edge.share * 100)}%`}
          source={SOURCES.DERIVED}
          detail="The road splits further on; traffic is divided by the number of lanes on each branch"
        />
      )}
      {folded > 0 && <div className={styles.paramDetail}>Passes {folded} merge/split point{folded === 1 ? '' : 's'} (folded into this road).</div>}
    </div>
  );
}

function RoadInspector({ road, lookups, onSelect }) {
  const edges = road.edgeIds.map((id) => lookups.edgeById.get(id));
  const name = edges.find((e) => e.name)?.name;
  const info = ROAD_CLASSES[edges[0].highway] || ROAD_CLASSES.unclassified;
  return (
    <>
      <div className={styles.inspectorHead}>
        <span className={styles.classChip} style={{ '--chip': info.color }}>{info.label}</span>
        <h3>{name || 'Unnamed road'}</h3>
        <div className={styles.inspectorSub}>
          between <NodeChip id={road.a} lookups={lookups} onSelect={onSelect} /> and <NodeChip id={road.b} lookups={lookups} onSelect={onSelect} />
        </div>
      </div>
      <section className={styles.inspectorSection}>
        <div className={styles.facts}>
          <Fact label="Directions" value={edges.length === 2 ? 'Two-way' : 'One-way'} />
          <Fact label="Length" value={formatLength(edges[0].lengthM)} />
        </div>
      </section>
      <section className={styles.inspectorSection}>
        <h4>Directions <span className={styles.muted}>(one simulation edge each)</span></h4>
        {edges.map((e) => <EdgeCard key={e.id} edge={e} lookups={lookups} onSelect={onSelect} />)}
      </section>
    </>
  );
}

function GatewayInspector({ gateway: g, lookups, onSelect }) {
  const c = gatewayColors(g.role);
  const feeders = g.feederEdgeIds.map((id) => lookups.edgeById.get(id));
  const exits = g.exitEdgeIds.map((id) => lookups.edgeById.get(id));
  return (
    <>
      <div className={styles.inspectorHead}>
        <span className={styles.kindBadge} style={{ '--badge': c.fill }}>
          {g.role === 'both' ? 'Source + sink' : g.role === 'source' ? 'Source' : 'Sink'}
        </span>
        <h3>{g.junctionName || g.roadName || 'Unnamed road'}</h3>
        <div className={styles.inspectorSub}>
          <code>{g.id}</code> ·{' '}
          {g.placedAt === 'junction'
            ? 'the first junction outside your area on this road'
            : 'no junction found within the download margin — placed at the margin edge'}
        </div>
      </div>
      <section className={styles.inspectorSection}>
        <p className={styles.explain}>
          {g.role !== 'sink' && 'Traffic enters the network here. In the City Simulator you set an inflow function (vehicles over time) on each feeder road below. '}
          {g.role !== 'source' && 'Traffic leaving the network ends here.'}
        </p>
      </section>
      {feeders.length > 0 && (
        <section className={styles.inspectorSection}>
          <h4>Feeder roads (in)</h4>
          {feeders.map((e) => (
            <button key={e.id} type="button" className={styles.roadRow} onClick={() => onSelect({ type: 'road', id: e.roadId })}>
              <span style={{ color: CITY_COLORS.feeder }}>➜</span>
              <span className={styles.roadRowName}>{e.name || 'Unnamed road'} → {e.to} ({e.toArm} arm)</span>
              <span className={styles.muted}>{formatLength(e.lengthM)} · {e.lanes.value} lane(s)</span>
            </button>
          ))}
        </section>
      )}
      {exits.length > 0 && (
        <section className={styles.inspectorSection}>
          <h4>Exit roads (out)</h4>
          {exits.map((e) => (
            <button key={e.id} type="button" className={styles.roadRow} onClick={() => onSelect({ type: 'road', id: e.roadId })}>
              <span style={{ color: CITY_COLORS.exit }}>➜</span>
              <span className={styles.roadRowName}>{e.from} ({e.fromArm} arm) → {e.name || 'Unnamed road'}</span>
              <span className={styles.muted}>{formatLength(e.lengthM)} · {e.lanes.value} lane(s)</span>
            </button>
          ))}
        </section>
      )}
    </>
  );
}

export function buildCityLookups(city) {
  if (!city) return null;
  const intersectionById = new Map(city.intersections.map((i) => [i.id, i]));
  const gatewayById = new Map(city.gateways.map((g) => [g.id, g]));
  return {
    intersectionById,
    gatewayById,
    edgeById: new Map(city.edges.map((e) => [e.id, e])),
    roadById: new Map(city.roads.map((r) => [r.id, r])),
    nodeById: (id) => intersectionById.get(id) || gatewayById.get(id),
  };
}

export default function CityInspector({ selection, lookups, onSelect }) {
  if (!selection || !lookups) return null;
  let body = null;
  if (selection.type === 'intersection') {
    const i = lookups.intersectionById.get(selection.id);
    if (i) body = <IntersectionInspector intersection={i} lookups={lookups} onSelect={onSelect} />;
  } else if (selection.type === 'road') {
    const r = lookups.roadById.get(selection.id);
    if (r) body = <RoadInspector road={r} lookups={lookups} onSelect={onSelect} />;
  } else if (selection.type === 'gateway') {
    const g = lookups.gatewayById.get(selection.id);
    if (g) body = <GatewayInspector gateway={g} lookups={lookups} onSelect={onSelect} />;
  }
  if (!body) return null;
  return (
    <aside className={styles.inspector}>
      <button type="button" className={styles.closeBtn} onClick={() => onSelect(null)} aria-label="Close inspector">×</button>
      {body}
    </aside>
  );
}
