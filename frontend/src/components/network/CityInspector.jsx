import { ROAD_CLASSES, SOURCES } from '../../network/roadDefaults.js';
import { PHASES } from '../../simulation/constants.js';
import { SourceBadge } from './Inspector.jsx';
import { CITY_COLORS, gatewayColors } from './scenes.js';
import { formatDuration, formatLength } from './networkStyle.js';
import styles from './NetworkExplorer.module.css';

const TURN_LABEL = { L: 'Left (free)', T: 'Through', R: 'Right' };
const DIR_NAME = { N: 'North', E: 'East', S: 'South', W: 'West' };
const EDGE_KIND = {
  internal: { label: 'Road', color: CITY_COLORS.road },
  feeder: { label: 'Inflow road', color: CITY_COLORS.feeder },
  exit: { label: 'Outflow road', color: CITY_COLORS.exit },
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
  const junction = lookups.junctionById.has(id);
  const color = gateway ? gatewayColors(node.role).fill : junction ? CITY_COLORS.junction : CITY_COLORS.intersection;
  return (
    <button type="button" className={styles.junctionChip} onClick={() => onSelect({ type: gateway ? 'gateway' : junction ? 'junction' : 'intersection', id })}>
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
  const ends = (ids, key) => Array.from(new Set(ids.map((id) => lookups.linkById.get(id)[key])));

  return (
    <>
      <div className={styles.inspectorHead}>
        <span className={styles.kindBadge} style={{ '--badge': CITY_COLORS.intersection }}>
          {roundabout ? 'Roundabout, signalized' : `${i.armCount}-arm signalized intersection`}
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
          Arms in grid slots N/E/S/W
          {i.frameRotation ? ` (frame turned ${Math.abs(i.frameRotation)}° ${i.frameRotation > 0 ? 'clockwise' : 'anticlockwise'})` : ''}.
          {i.originalArmCount > 4 ? ` The real junction has ${i.originalArmCount} arms; arms from the same direction were joined.` : ''}
        </p>
      </section>

      <section className={styles.inspectorSection}>
        <h4>Arms</h4>
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
                    {a.turnLane && <span className={styles.tag}>turn lane</span>}
                  </td>
                  <td>{a.inLinkIds.length ? ends(a.inLinkIds, 'from').map((id) => <NodeChip key={id} id={id} lookups={lookups} onSelect={onSelect} />) : <span className={styles.muted}>-</span>}</td>
                  <td>{a.outLinkIds.length ? ends(a.outLinkIds, 'to').map((id) => <NodeChip key={id} id={id} lookups={lookups} onSelect={onSelect} />) : <span className={styles.muted}>-</span>}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </section>

      <section className={styles.inspectorSection}>
        <h4>Turns</h4>
        <div className={styles.movementGrid}>
          {arms.filter((d) => i.arms[d].inLinkIds.length).map((from) => (
            <div key={from} className={styles.movementRow}>
              <span className={styles.movementFrom}>From {from}</span>
              {['L', 'T', 'R'].map((turn) => {
                const m = i.movements.find((x) => x.from === from && x.turn === turn);
                if (!m) return <span key={turn} className={styles.moveNone} title="No road in that direction">{turn}</span>;
                return (
                  <span key={turn} className={m.allowed ? styles[`move${turn}`] : styles.moveBlocked} title={`${TURN_LABEL[turn]} to the ${DIR_NAME[m.to]} arm${m.allowed ? '' : ' (not allowed)'}`}>
                    {turn} → {m.to}
                  </span>
                );
              })}
            </div>
          ))}
        </div>
      </section>

      <section className={styles.inspectorSection}>
        <h4>Signal phases <span className={styles.muted}>({i.phases.length} of 8 usable)</span></h4>
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
          detail="Information only. Every intersection here is signal-controlled for both policies."
        />
      </section>
    </>
  );
}

function LinkCard({ link, lookups, onSelect }) {
  const kind = EDGE_KIND[lookups.gatewayById.has(link.from) ? 'feeder' : lookups.gatewayById.has(link.to) ? 'exit' : 'internal'];
  return (
    <div className={styles.directionCard}>
      <div className={styles.directionHead}>
        <NodeChip id={link.from} lookups={lookups} onSelect={onSelect} />
        {link.fromArm && <span className={styles.muted}>{link.fromArm} arm</span>}
        <span className={styles.directionArrow}>→</span>
        <NodeChip id={link.to} lookups={lookups} onSelect={onSelect} />
        {link.toArm && <span className={styles.muted}>{link.toArm} arm</span>}
        <code className={styles.linkId}>{link.id}</code>
      </div>
      <span className={styles.kindBadge} style={{ '--badge': kind.color }}>{kind.label}</span>
      <Param label="Length" value={formatLength(link.lengthM)} source={SOURCES.DERIVED} detail="Measured along the real road" />
      <Param label="Lanes" value={link.lanes.value} source={link.lanes.source} detail={link.lanes.detail} />
      <Param label="Speed limit" value={`${link.speedKmh.value} km/h`} source={link.speedKmh.source} detail={link.speedKmh.detail} />
      <Param label="Free-flow travel time" value={formatDuration(link.lengthM / (link.speedKmh.value / 3.6))} source={SOURCES.DERIVED} detail="Length ÷ speed" />
    </div>
  );
}

function RoadInspector({ road, lookups, onSelect }) {
  const links = road.linkIds.map((id) => lookups.linkById.get(id));
  const name = links.find((l) => l.name)?.name;
  const info = ROAD_CLASSES[links[0].highway] || ROAD_CLASSES.unclassified;
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
          <Fact label="Directions" value={links.length > 1 ? 'Two-way' : 'One-way'} />
          <Fact label="Length" value={formatLength(links[0].lengthM)} />
        </div>
      </section>
      <section className={styles.inspectorSection}>
        <h4>Directions</h4>
        {links.map((l) => <LinkCard key={l.id} link={l} lookups={lookups} onSelect={onSelect} />)}
      </section>
    </>
  );
}

function RoadRows({ title, links, arrowColor, describe, onSelect }) {
  if (!links.length) return null;
  return (
    <section className={styles.inspectorSection}>
      <h4>{title}</h4>
      {links.map((l) => (
        <button key={l.id} type="button" className={styles.roadRow} onClick={() => onSelect({ type: 'road', id: l.roadId })}>
          <span style={{ color: arrowColor }}>➜</span>
          <span className={styles.roadRowName}>{describe(l)}</span>
          <span className={styles.muted}>{formatLength(l.lengthM)} · {l.lanes.value} lane(s)</span>
        </button>
      ))}
    </section>
  );
}

function GatewayInspector({ gateway: g, lookups, onSelect }) {
  const c = gatewayColors(g.role);
  return (
    <>
      <div className={styles.inspectorHead}>
        <span className={styles.kindBadge} style={{ '--badge': c.fill }}>
          {g.role === 'both' ? 'Source and sink' : g.role === 'source' ? 'Source' : 'Sink'}
        </span>
        <h3>{g.junctionName || g.roadName || 'Unnamed road'}</h3>
        <div className={styles.inspectorSub}>
          <code>{g.id}</code> · {g.placedAt === 'junction' ? 'first junction outside your area on this road' : 'placed at the download margin edge'}
        </div>
      </div>
      <RoadRows title="Roads in" links={g.outLinkIds.map((id) => lookups.linkById.get(id))} arrowColor={CITY_COLORS.feeder} describe={(l) => `${l.name || 'Unnamed road'} → ${l.to}`} onSelect={onSelect} />
      <RoadRows title="Roads out" links={g.inLinkIds.map((id) => lookups.linkById.get(id))} arrowColor={CITY_COLORS.exit} describe={(l) => `${l.from} → ${l.name || 'Unnamed road'}`} onSelect={onSelect} />
    </>
  );
}

function JunctionInspector({ junction: j, lookups, onSelect }) {
  return (
    <>
      <div className={styles.inspectorHead}>
        <span className={styles.kindBadge} style={{ '--badge': CITY_COLORS.junction }}>Junction, no signal</span>
        <h3>{j.name || 'Unnamed junction'}</h3>
        <div className={styles.inspectorSub}><code>{j.id}</code> · roads join or split here without waiting</div>
      </div>
      <RoadRows title="Roads in" links={j.inLinkIds.map((id) => lookups.linkById.get(id))} arrowColor={CITY_COLORS.road} describe={(l) => `${l.from} → ${l.name || 'Unnamed road'}`} onSelect={onSelect} />
      <RoadRows title="Roads out" links={j.outLinkIds.map((id) => lookups.linkById.get(id))} arrowColor={CITY_COLORS.road} describe={(l) => `${l.name || 'Unnamed road'} → ${l.to}`} onSelect={onSelect} />
    </>
  );
}

export function buildCityLookups(city) {
  if (!city) return null;
  const intersectionById = new Map(city.intersections.map((i) => [i.id, i]));
  const gatewayById = new Map(city.gateways.map((g) => [g.id, g]));
  const junctionById = new Map(city.junctions.map((j) => [j.id, j]));
  return {
    intersectionById,
    gatewayById,
    junctionById,
    linkById: new Map(city.links.map((l) => [l.id, l])),
    edgeById: new Map(city.edges.map((e) => [e.id, e])),
    roadById: new Map(city.roads.map((r) => [r.id, r])),
    nodeById: (id) => intersectionById.get(id) || gatewayById.get(id) || junctionById.get(id),
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
  } else if (selection.type === 'junction') {
    const j = lookups.junctionById.get(selection.id);
    if (j) body = <JunctionInspector junction={j} lookups={lookups} onSelect={onSelect} />;
  }
  if (!body) return null;
  return (
    <aside className={styles.inspector}>
      <button type="button" className={styles.closeBtn} onClick={() => onSelect(null)} aria-label="Close inspector">×</button>
      {body}
    </aside>
  );
}
