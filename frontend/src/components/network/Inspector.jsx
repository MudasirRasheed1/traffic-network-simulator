import { MODEL_CONSTANTS, ROAD_CLASSES, SOURCES } from '../../network/roadDefaults.js';
import { JUNCTION_KINDS, SOURCE_BADGES, formatDuration, formatLength } from './networkStyle.js';
import styles from './NetworkExplorer.module.css';

const TURN_LABELS = { L: 'Left', T: 'Through', R: 'Right', U: 'U-turn' };
const osmLink = (type, id) => `https://www.openstreetmap.org/${type}/${id}`;

export function SourceBadge({ source }) {
  const badge = SOURCE_BADGES[source];
  if (!badge) return null;
  return (
    <span className={styles.sourceBadge} style={{ '--badge': badge.color }} title={badge.hint}>
      {badge.label}
    </span>
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

function Fact({ label, value }) {
  return (
    <div className={styles.fact}>
      <span>{label}</span>
      <strong>{value}</strong>
    </div>
  );
}

function Compass({ bearing }) {
  return (
    <span className={styles.compass} style={{ transform: `rotate(${bearing}deg)` }} aria-hidden="true">↑</span>
  );
}

function ClassChip({ highway }) {
  const info = ROAD_CLASSES[highway] || ROAD_CLASSES.unclassified;
  return <span className={styles.classChip} style={{ '--chip': info.color }}>{info.label}</span>;
}

function JunctionChip({ junction, onSelect }) {
  if (!junction) return null;
  return (
    <button type="button" className={styles.junctionChip} onClick={() => onSelect({ type: 'junction', id: junction.id })}>
      <span style={{ background: JUNCTION_KINDS[junction.kind]?.color }} />
      {junction.id}
    </button>
  );
}

// ---------------------------------------------------------------
function JunctionInspector({ junction: j, lookups, onSelect }) {
  const kind = JUNCTION_KINDS[j.kind];
  const inLinks = j.legs.filter((l) => l.inLinkId).length;
  const outLinks = j.legs.filter((l) => l.outLinkId).length;
  const allowed = j.movements.filter((m) => m.allowed);

  // Aggregate movements to an arm × arm matrix.
  const matrix = new Map();
  for (const m of j.movements) {
    const key = `${m.fromArm}:${m.toArm}`;
    const prev = matrix.get(key);
    if (!prev || (!prev.allowed && m.allowed)) matrix.set(key, m);
  }
  const armLabel = (arm, i) => `${String.fromCharCode(65 + i)} · ${arm.compass}`;

  return (
    <>
      <div className={styles.inspectorHead}>
        <span className={styles.kindBadge} style={{ '--badge': kind?.color }}>
          {j.kind === 'boundary' ? (j.boundaryRole === 'exit' ? 'Boundary exit' : 'Boundary entry') : kind?.label}
        </span>
        <h3>{j.name || (j.kind === 'boundary' ? 'Network edge' : 'Unnamed junction')}</h3>
        <div className={styles.inspectorSub}>
          <code>{j.id}</code> · {j.lat.toFixed(5)}, {j.lon.toFixed(5)} ·{' '}
          <a href={`https://www.openstreetmap.org/?mlat=${j.lat}&mlon=${j.lon}#map=19/${j.lat}/${j.lon}`} target="_blank" rel="noreferrer">
            open in OSM ↗
          </a>
        </div>
      </div>

      {j.kind === 'boundary' ? (
        <section className={styles.inspectorSection}>
          <p className={styles.explain}>
            A road crosses the edge of the selected area here. {j.boundaryRole !== 'exit'
              ? 'Vehicles can enter the network at this point, so an inflow function will attach here in the simulation step.'
              : 'Vehicles can only leave the network here (one-way outbound).'}
          </p>
          <div className={styles.facts}>
            <Fact label="Role" value={j.boundaryRole === 'entry_exit' ? 'Entry + exit' : j.boundaryRole === 'entry' ? 'Entry only' : 'Exit only'} />
            <Fact label="Road" value={j.arms[0]?.name || j.legs[0]?.roadId} />
            <Fact label="Lanes in → network" value={j.legs[0]?.outLanes ?? 0} />
            <Fact label="Lanes out of network" value={j.legs[0]?.inLanes ?? 0} />
          </div>
        </section>
      ) : (
        <>
          <section className={styles.inspectorSection}>
            <div className={styles.facts}>
              <Fact label="Arms" value={j.arms.length} />
              <Fact label="Incoming links" value={inLinks} />
              <Fact label="Outgoing links" value={outLinks} />
              <Fact label="Allowed movements" value={allowed.length} />
            </div>
          </section>

          <section className={styles.inspectorSection}>
            <h4>Parameters</h4>
            <Param
              label="Signal control"
              value={j.signal.value ? 'Signalized' : 'No signal'}
              source={j.signal.value ? SOURCES.OSM : SOURCES.DEFAULT}
              detail={j.signal.value ? j.signal.detail : 'No highway=traffic_signals node on or near this junction in OSM'}
            />
            <Param
              label="Junction type"
              value={kind?.short}
              source={SOURCES.DERIVED}
              detail={j.isRoundabout ? 'Contains OSM ways tagged junction=roundabout' : `Classified from ${j.arms.length} arm(s) and signal evidence`}
            />
            <Param
              label="Merged OSM nodes"
              value={j.osmNodes.length}
              source={SOURCES.DERIVED}
              detail={j.osmNodes.length > 1
                ? 'Several OSM points form this one physical junction (divided roads / roundabout) — shown as yellow dots'
                : 'Single OSM junction node'}
            />
          </section>

          <section className={styles.inspectorSection}>
            <h4>Arms <span className={styles.muted}>(approach roads, clockwise from north)</span></h4>
            <table className={styles.table}>
              <thead>
                <tr><th></th><th>Road</th><th>In</th><th>Out</th></tr>
              </thead>
              <tbody>
                {j.arms.map((arm, i) => {
                  const firstRoad = j.legs[arm.legIndices[0]]?.roadId;
                  return (
                    <tr key={i} className={styles.clickRow} onClick={() => firstRoad && onSelect({ type: 'road', id: firstRoad })}>
                      <td className={styles.armCell}><strong>{String.fromCharCode(65 + i)}</strong><Compass bearing={arm.bearing} /><span>{arm.compass}</span></td>
                      <td>
                        <div>{arm.name || <span className={styles.muted}>Unnamed</span>}</div>
                        <ClassChip highway={arm.highway} />{arm.divided && <span className={styles.tag}>divided</span>}
                      </td>
                      <td>{arm.inLanes || '—'}</td>
                      <td>{arm.outLanes || '—'}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
            <div className={styles.paramDetail}>In/Out = lanes arriving at / leaving the junction on that arm.</div>
          </section>

          {j.arms.length > 1 && (
            <section className={styles.inspectorSection}>
              <h4>Turning movements <span className={styles.muted}>(from row → to column)</span></h4>
              <div className={styles.matrixWrap}>
                <table className={styles.matrix}>
                  <thead>
                    <tr>
                      <th></th>
                      {j.arms.map((arm, i) => <th key={i}>{String.fromCharCode(65 + i)}</th>)}
                    </tr>
                  </thead>
                  <tbody>
                    {j.arms.map((fromArm, fi) => (
                      <tr key={fi}>
                        <th>{armLabel(fromArm, fi)}</th>
                        {j.arms.map((toArm, ti) => {
                          const m = matrix.get(`${fi}:${ti}`);
                          if (!m) return <td key={ti} className={styles.cellNone}>·</td>;
                          return (
                            <td
                              key={ti}
                              className={m.allowed ? styles[`turn${m.turn}`] : styles.cellBlocked}
                              title={`${TURN_LABELS[m.turn]} (${m.angle > 0 ? '+' : ''}${m.angle}°)${m.allowed ? '' : ` — blocked: ${m.reason}`}`}
                            >
                              {m.turn}
                            </td>
                          );
                        })}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <div className={styles.paramDetail}>
                L / T / R / U = left, through, right, U-turn — from the angle between arms. Struck cells are blocked (U-turns by default, or an OSM turn restriction). Hover a cell for details.
              </div>
            </section>
          )}

          {j.restrictions.length > 0 && (
            <section className={styles.inspectorSection}>
              <h4>Turn restrictions (OSM)</h4>
              {j.restrictions.map((r) => (
                <div key={r.relationId} className={styles.listRow}>
                  <code>{r.kind}</code>
                  <a href={osmLink('relation', r.relationId)} target="_blank" rel="noreferrer">relation {r.relationId} ↗</a>
                  <span className={styles.muted}>{r.movementsAffected} movement(s)</span>
                </div>
              ))}
            </section>
          )}
        </>
      )}

      <section className={styles.inspectorSection}>
        <h4>OSM source nodes</h4>
        <div className={styles.idList}>
          {j.osmNodes.length === 0 && <span className={styles.muted}>Synthetic point where the road meets the area edge.</span>}
          {j.osmNodes.map((n) => (
            <a key={n.id} href={osmLink('node', n.id)} target="_blank" rel="noreferrer">{n.id}</a>
          ))}
          {j.signal.evidence.map((ev) => (
            <a key={`s${ev.osmNodeId}`} href={osmLink('node', ev.osmNodeId)} target="_blank" rel="noreferrer" className={styles.signalLink}>
              signal {ev.osmNodeId}{ev.distanceM ? ` (${ev.distanceM} m)` : ''}
            </a>
          ))}
        </div>
      </section>
      <RoadsList junction={j} lookups={lookups} onSelect={onSelect} />
    </>
  );
}

function RoadsList({ junction, lookups, onSelect }) {
  return (
    <section className={styles.inspectorSection}>
      <h4>Connected roads</h4>
      {junction.legs.map((leg) => {
        const road = lookups.roadById.get(leg.roadId);
        const other = road.from === junction.id ? road.to : road.from;
        return (
          <button key={leg.roadId} type="button" className={styles.roadRow} onClick={() => onSelect({ type: 'road', id: road.id })}>
            <Compass bearing={leg.bearing} />
            <span className={styles.roadRowName}>{road.name || 'Unnamed road'}</span>
            <span className={styles.muted}>{road.id} → {other} · {formatLength(road.lengthM)}</span>
          </button>
        );
      })}
    </section>
  );
}

// ---------------------------------------------------------------
function DirectionCard({ link, lookups, onSelect }) {
  const from = lookups.junctionById.get(link.from);
  const to = lookups.junctionById.get(link.to);
  const { saturationFlowPerLaneVph, jamSpacingM } = MODEL_CONSTANTS;
  return (
    <div className={styles.directionCard}>
      <div className={styles.directionHead}>
        <JunctionChip junction={from} onSelect={onSelect} />
        <span className={styles.directionArrow}>→</span>
        <JunctionChip junction={to} onSelect={onSelect} />
        <code className={styles.linkId}>{link.id}</code>
      </div>
      <Param label="Lanes" value={link.lanes.value} source={link.lanes.source} detail={link.lanes.detail} />
      <Param label="Speed limit" value={`${link.speedKmh.value} km/h`} source={link.speedKmh.source} detail={link.speedKmh.detail} />
      <Param
        label="Free-flow travel time"
        value={formatDuration(link.freeFlowTimeS)}
        source={SOURCES.DERIVED}
        detail={`length ${Math.round(link.lengthM)} m ÷ speed ${link.speedKmh.value} km/h`}
      />
      <Param
        label="Saturation flow"
        value={`${link.saturationFlowVph.toLocaleString()} veh/h`}
        source={SOURCES.DERIVED}
        detail={`${link.lanes.value} lane(s) × ${saturationFlowPerLaneVph} veh/h/lane — max discharge rate on green`}
      />
      <Param
        label="Queue storage"
        value={`${link.storageVeh} vehicles`}
        source={SOURCES.DERIVED}
        detail={`${Math.round(link.lengthM)} m × ${link.lanes.value} lane(s) ÷ ${jamSpacingM} m per queued vehicle`}
      />
    </div>
  );
}

function RoadInspector({ road, lookups, onSelect }) {
  const links = road.linkIds.map((id) => lookups.linkById.get(id));
  return (
    <>
      <div className={styles.inspectorHead}>
        <ClassChip highway={road.highway} />
        <h3>{road.name || 'Unnamed road'}{road.ref ? <span className={styles.muted}> ({road.ref})</span> : null}</h3>
        <div className={styles.inspectorSub}>
          <code>{road.id}</code> · between <JunctionChip junction={lookups.junctionById.get(road.from)} onSelect={onSelect} /> and{' '}
          <JunctionChip junction={lookups.junctionById.get(road.to)} onSelect={onSelect} />
        </div>
      </div>

      <section className={styles.inspectorSection}>
        <div className={styles.facts}>
          <Fact label="Length" value={formatLength(road.lengthM)} />
          <Fact label="Direction" value={road.oneway ? 'One-way' : 'Two-way'} />
          <Fact label="Surface" value={road.surface || '—'} />
          <Fact label="Structure" value={road.bridge ? 'Bridge' : road.tunnel ? 'Tunnel' : 'At grade'} />
        </div>
        <Param label="Road width" value={`${road.width.value} m`} source={road.width.source} detail={road.width.detail} />
        <Param label="Length" value={`${road.lengthM.toFixed(1)} m`} source={SOURCES.DERIVED} detail="Measured along the OSM geometry (great-circle distance between points)" />
        {road.midblockSignals.length > 0 && (
          <div className={styles.paramDetail}>{road.midblockSignals.length} mid-block signal(s) (likely pedestrian crossing) — not treated as a junction.</div>
        )}
      </section>

      <section className={styles.inspectorSection}>
        <h4>Travel directions <span className={styles.muted}>(one simulation link each)</span></h4>
        {links.map((link) => <DirectionCard key={link.id} link={link} lookups={lookups} onSelect={onSelect} />)}
      </section>

      <section className={styles.inspectorSection}>
        <h4>OSM source ways</h4>
        <table className={styles.table}>
          <thead><tr><th>Way</th><th>Length</th><th>lanes</th><th>maxspeed</th><th>oneway</th></tr></thead>
          <tbody>
            {road.sections.map((s, i) => (
              <tr key={`${s.wayId}-${i}`}>
                <td><a href={osmLink('way', s.wayId)} target="_blank" rel="noreferrer">{s.wayId}</a></td>
                <td>{Math.round(s.lengthM)} m</td>
                <td>{s.tags.lanes ?? <span className={styles.muted}>—</span>}</td>
                <td>{s.tags.maxspeed ?? <span className={styles.muted}>—</span>}</td>
                <td>{s.tags.oneway ?? <span className={styles.muted}>—</span>}</td>
              </tr>
            ))}
          </tbody>
        </table>
        <div className={styles.paramDetail}>“—” = tag missing in OSM, so a default is used above.</div>
      </section>
    </>
  );
}

export default function Inspector({ selection, lookups, onSelect }) {
  if (!selection || !lookups) return null;
  const junction = selection.type === 'junction' ? lookups.junctionById.get(selection.id) : null;
  const road = selection.type === 'road' ? lookups.roadById.get(selection.id) : null;
  if (!junction && !road) return null;
  return (
    <aside className={styles.inspector}>
      <button type="button" className={styles.closeBtn} onClick={() => onSelect(null)} aria-label="Close inspector">×</button>
      {junction && <JunctionInspector junction={junction} lookups={lookups} onSelect={onSelect} />}
      {road && <RoadInspector road={road} lookups={lookups} onSelect={onSelect} />}
    </aside>
  );
}
