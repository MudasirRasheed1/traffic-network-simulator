import { useCityStore } from '../../store/useCityStore.js';
import { defaultInflowFor, effectiveEdge, makeRateProfile } from '../../simulation/cityNetwork.js';
import { makeFunctionInflowProfile, makeDistributionInflowProfile } from '../../simulation/arrivalProfile.js';
import { SOURCES, MODEL_CONSTANTS, ROAD_CLASSES } from '../../network/roadDefaults.js';
import { InflowFunctionEditor, InflowDistributionEditor } from '../ConfigPanel.jsx';
import { SourceBadge } from '../network/Inspector.jsx';
import { GridDiagram } from '../network/CityInspector.jsx';
import { CITY_COLORS, gatewayColors } from '../network/scenes.js';
import { formatDuration, formatLength } from '../network/networkStyle.js';
import nx from '../network/NetworkExplorer.module.css';
import styles from './CitySimulator.module.css';

const TURN_NAMES = { L: 'Left (free)', T: 'Through', R: 'Right' };
const EXIT_OF = {
  L: { N: 'E', S: 'W', E: 'S', W: 'N' },
  T: { N: 'S', S: 'N', E: 'W', W: 'E' },
  R: { N: 'W', S: 'E', E: 'N', W: 'S' },
};

function EditedBadge() {
  return <span className={styles.editedBadge} title="You changed this value">Edited</span>;
}

// A number that comes from the map but can be overridden.
function NumberOverride({ label, value, mapValue, unit, source, detail, onChange, step = 1, min = 0, disabled }) {
  const edited = value != null;
  return (
    <div className={nx.param}>
      <div className={nx.paramHead}>
        <span className={nx.paramLabel}>{label}</span>
        <input
          className={styles.numInput}
          type="number"
          min={min}
          step={step}
          value={edited ? value : mapValue}
          disabled={disabled}
          onChange={(e) => {
            const v = Number(e.target.value);
            if (!Number.isFinite(v) || v < min) return;
            onChange(v === mapValue ? null : v);
          }}
        />
        <span className={styles.unit}>{unit}</span>
        {edited ? <EditedBadge /> : <SourceBadge source={source} />}
      </div>
      <div className={nx.paramDetail}>
        {edited ? (
          <>From the map: {mapValue} {unit} · <button type="button" className={nx.linkBtn} onClick={() => onChange(null)}>reset</button></>
        ) : detail}
      </div>
    </div>
  );
}

function NodeChip({ id, onSelect, isGateway, role }) {
  const color = isGateway ? gatewayColors(role).fill : CITY_COLORS.intersection;
  return (
    <button type="button" className={nx.junctionChip} onClick={() => onSelect({ type: isGateway ? 'gateway' : 'intersection', id })}>
      <span style={{ background: color, borderRadius: isGateway ? 2 : '50%' }} />
      {id}
    </button>
  );
}

// ---------------------------------------------------------------
// Intersection: live state + turn shares per arm
// ---------------------------------------------------------------
function TurnSharesEditor({ arm, intersection, probs, edited, available, onChange }) {
  const pct = (v) => Math.round(v * 100);
  const setOne = (turn, percent) => {
    const next = { ...probs, [turn]: Math.max(0, Math.min(100, percent)) / 100 };
    onChange(next);
  };
  const total = ['L', 'T', 'R'].filter((t) => available[t]).reduce((s, t) => s + probs[t], 0);
  return (
    <div className={styles.turnRow}>
      <span className={styles.turnArm}>From {arm}</span>
      {['L', 'T', 'R'].map((turn) => (
        <label key={turn} className={available[turn] ? styles.turnCell : styles.turnCellOff} title={available[turn] ? `${TURN_NAMES[turn]} → ${EXIT_OF[turn][arm]} arm` : 'No road that way'}>
          <span>{turn}</span>
          <input type="number" min="0" max="100" step="5" value={available[turn] ? pct(probs[turn]) : 0} disabled={!available[turn]} onChange={(e) => setOne(turn, Number(e.target.value) || 0)} />
        </label>
      ))}
      <span className={styles.turnTotal}>
        {total > 0 && Math.abs(total - 1) > 0.01 ? `→ scaled to 100%` : ''}
        {edited && <button type="button" className={nx.linkBtn} onClick={() => onChange(null)}>reset</button>}
      </span>
    </div>
  );
}

function IntersectionPanel({ intersection: i, snapshot, onSelect, stepSeconds }) {
  const { overrides, config, setEdgeOverride, city } = useCityStore();
  const edgeById = new Map(city.edges.map((e) => [e.id, e]));
  const arms = ['N', 'E', 'S', 'W'].filter((d) => i.arms[d]);
  const liveF = snapshot?.fixed.intersections[i.id];
  const liveG = snapshot?.greedy.intersections[i.id];
  const maxQ = Math.max(1, ...arms.flatMap((d) => [liveF?.queueLengths[d] || 0, liveG?.queueLengths[d] || 0]));
  const available = (from) => Object.fromEntries(['L', 'T', 'R'].map((turn) => {
    const to = EXIT_OF[turn][from];
    const m = i.movements.find((x) => x.from === from && x.to === to);
    return [turn, Boolean(m?.allowed)];
  }));

  return (
    <>
      <div className={nx.inspectorHead}>
        <span className={nx.kindBadge} style={{ '--badge': CITY_COLORS.intersection }}>
          {i.originalKind === 'roundabout' ? 'Roundabout → signalized' : `${i.armCount}-arm signalized intersection`}
        </span>
        <h3>{i.name || 'Unnamed intersection'}</h3>
        <div className={nx.inspectorSub}><code>{i.id}</code> · {i.phases.length} usable phases</div>
      </div>
      <section className={nx.inspectorSection}>
        <GridDiagram intersection={i} />
      </section>

      {snapshot && (
        <section className={nx.inspectorSection}>
          <h4>Right now <span className={nx.muted}>(minute {((snapshot.time * stepSeconds) / 60).toFixed(1)})</span></h4>
          <div className={styles.liveCompare}>
            <div><span className={styles.dotFixed} />Fixed: <strong>{liveF.currentPhase}</strong> · {liveF.totalQueued} queued · {liveF.vehiclesServed} served</div>
            <div><span className={styles.dotGreedy} />Your policy: <strong>{liveG.currentPhase}</strong> · {liveG.totalQueued} queued · {liveG.vehiclesServed} served</div>
          </div>
          {arms.map((d) => (
            <div key={d} className={styles.queueBarRow}>
              <span>{d}</span>
              <div className={styles.queueBars}>
                <div className={styles.barFixed} style={{ width: `${((liveF.queueLengths[d] || 0) / maxQ) * 100}%` }}><em>{liveF.queueLengths[d]}</em></div>
                <div className={styles.barGreedy} style={{ width: `${((liveG.queueLengths[d] || 0) / maxQ) * 100}%` }}><em>{liveG.queueLengths[d]}</em></div>
              </div>
            </div>
          ))}
          <p className={nx.paramDetail}>Cars waiting on each arm — top bar Fixed, bottom bar your policy.</p>
        </section>
      )}

      <section className={nx.inspectorSection}>
        <h4>Turn shares <span className={nx.muted}>(% of cars arriving on each arm)</span></h4>
        {arms.filter((d) => i.arms[d].inEdgeIds.length).map((d) => {
          const edgeIds = i.arms[d].inEdgeIds;
          const edited = edgeIds.some((id) => overrides.edges[id]?.turnProbs);
          const probs = overrides.edges[edgeIds[0]]?.turnProbs || config.defaultTurn;
          return (
            <TurnSharesEditor
              key={d}
              arm={d}
              intersection={i}
              probs={probs}
              edited={edited}
              available={available(d)}
              onChange={(next) => edgeIds.forEach((id) => setEdgeOverride(id, { turnProbs: next }))}
            />
          );
        })}
        <p className={nx.paramDetail}>
          Default {Math.round(config.defaultTurn.L * 100)} / {Math.round(config.defaultTurn.T * 100)} / {Math.round(config.defaultTurn.R * 100)} % (left / through / right, set in the sidebar).
          Turns with no road are dropped and the rest rescaled.
        </p>
      </section>

      <section className={nx.inspectorSection}>
        <h4>Approach roads</h4>
        {arms.map((d) => i.arms[d].inEdgeIds.map((id) => {
          const e = edgeById.get(id);
          return (
            <button key={id} type="button" className={nx.roadRow} onClick={() => onSelect({ type: 'road', id: e.roadId })}>
              <span className={nx.compass}>{d}</span>
              <span className={nx.roadRowName}>{e.name || 'Unnamed road'} {overrides.edges[id] ? '· edited' : ''}</span>
              <span className={nx.muted}>from {e.from} · {formatLength(e.lengthM)} · {effectiveEdge(e, overrides.edges).lanes} lane(s)</span>
            </button>
          );
        }))}
      </section>
    </>
  );
}

// ---------------------------------------------------------------
// Road: per-direction parameters with overrides
// ---------------------------------------------------------------
function EdgeEditor({ edge, snapshot, onSelect, stepSeconds, gatewayRole }) {
  const { overrides, setEdgeOverride } = useCityStore();
  const o = overrides.edges[edge.id] || {};
  const eff = effectiveEdge(edge, overrides.edges);
  const kindLabel = edge.kind === 'feeder' ? 'Feeder (in)' : edge.kind === 'exit' ? 'Exit (out)' : 'Road';
  const kindColor = edge.kind === 'feeder' ? CITY_COLORS.feeder : edge.kind === 'exit' ? CITY_COLORS.exit : CITY_COLORS.road;
  const travelSteps = Math.max(1, Math.round(eff.freeFlowTimeS / stepSeconds));
  return (
    <div className={nx.directionCard}>
      <div className={nx.directionHead}>
        <NodeChip id={edge.from} onSelect={onSelect} isGateway={edge.kind === 'feeder'} role={gatewayRole(edge.from)} />
        <span className={nx.directionArrow}>→</span>
        <NodeChip id={edge.to} onSelect={onSelect} isGateway={edge.kind === 'exit'} role={gatewayRole(edge.to)} />
        <span className={nx.kindBadge} style={{ '--badge': kindColor }}>{kindLabel}</span>
      </div>
      <NumberOverride
        label="Lanes"
        value={o.lanes}
        mapValue={edge.lanes.value}
        unit="lanes"
        min={1}
        source={edge.lanes.source}
        detail={edge.lanes.detail}
        onChange={(v) => setEdgeOverride(edge.id, { lanes: v })}
      />
      <NumberOverride
        label="Speed limit"
        value={o.speedKmh}
        mapValue={edge.speedKmh.value}
        unit="km/h"
        min={5}
        step={5}
        source={edge.speedKmh.source}
        detail={edge.speedKmh.detail}
        onChange={(v) => setEdgeOverride(edge.id, { speedKmh: v })}
      />
      {edge.kind !== 'exit' && (
        <NumberOverride
          label="Saturation flow"
          value={o.saturationFlowVph}
          mapValue={eff.lanes * MODEL_CONSTANTS.saturationFlowPerLaneVph}
          unit="veh/h"
          min={100}
          step={100}
          source={SOURCES.DERIVED}
          detail={`${eff.lanes} lane(s) × ${MODEL_CONSTANTS.saturationFlowPerLaneVph} veh/h — how fast this approach empties on green`}
          onChange={(v) => setEdgeOverride(edge.id, { saturationFlowVph: v })}
        />
      )}
      <div className={nx.param}>
        <div className={nx.paramHead}>
          <span className={nx.paramLabel}>Travel time</span>
          <span className={nx.paramValue}>{formatDuration(eff.freeFlowTimeS)} → {travelSteps} step{travelSteps === 1 ? '' : 's'}</span>
          <SourceBadge source={SOURCES.DERIVED} />
        </div>
        <div className={nx.paramDetail}>{formatLength(edge.lengthM)} at {eff.speedKmh} km/h, in {stepSeconds}-second steps</div>
      </div>
      {snapshot && (
        <div className={styles.liveCompare}>
          <div><span className={styles.dotFixed} />Fixed: {snapshot.fixed.edges[edge.id] ?? 0} car(s) driving</div>
          <div><span className={styles.dotGreedy} />Your policy: {snapshot.greedy.edges[edge.id] ?? 0} car(s) driving</div>
        </div>
      )}
    </div>
  );
}

function RoadPanel({ road, snapshot, onSelect, stepSeconds, gatewayRole }) {
  const { city } = useCityStore();
  const edges = road.edgeIds.map((id) => city.edges.find((e) => e.id === id));
  const info = ROAD_CLASSES[edges[0].highway] || ROAD_CLASSES.unclassified;
  return (
    <>
      <div className={nx.inspectorHead}>
        <span className={nx.classChip} style={{ '--chip': info.color }}>{info.label}</span>
        <h3>{edges.find((e) => e.name)?.name || 'Unnamed road'}</h3>
        <div className={nx.inspectorSub}>{formatLength(edges[0].lengthM)} · {edges.length === 2 ? 'two-way' : 'one-way'}</div>
      </div>
      <section className={nx.inspectorSection}>
        <h4>Directions</h4>
        {edges.map((e) => <EdgeEditor key={e.id} edge={e} snapshot={snapshot} onSelect={onSelect} stepSeconds={stepSeconds} gatewayRole={gatewayRole} />)}
      </section>
    </>
  );
}

// ---------------------------------------------------------------
// Gateway: inflow per feeder road
// ---------------------------------------------------------------
function InflowEditor({ edge }) {
  const { inflows, config, overrides, setInflow, setAllInflows, city } = useCityStore();
  const custom = inflows[edge.id];
  const profile = custom || defaultInflowFor(edge, config, overrides.edges);
  const mode = profile.mode === 'function' ? 'function' : profile.mode === 'distribution' ? 'distribution' : 'rate';
  const perStepNote = `1 car per step = ${Math.round(3600 / config.stepSeconds)} veh/h`;

  const changeMode = (next) => {
    if (next === 'rate') setInflow(edge.id, makeRateProfile(profile.vehPerHour ?? 600));
    if (next === 'function') setInflow(edge.id, makeFunctionInflowProfile());
    if (next === 'distribution') setInflow(edge.id, makeDistributionInflowProfile());
  };
  const applyToAll = () => {
    const next = {};
    for (const e of city.edges.filter((x) => x.kind === 'feeder')) next[e.id] = JSON.parse(JSON.stringify(profile));
    setAllInflows(next);
  };

  return (
    <div className={nx.directionCard}>
      <div className={nx.directionHead}>
        <span className={nx.roadRowName}>{edge.name || 'Unnamed road'}</span>
        <span className={nx.muted}>→ {edge.to} ({edge.toArm} arm) · {formatLength(edge.lengthM)}</span>
        {custom ? <EditedBadge /> : <SourceBadge source={SOURCES.DEFAULT} />}
      </div>
      <div className={nx.segmented} style={{ margin: '6px 0' }}>
        {[['rate', 'Steady (veh/h)'], ['function', 'Function'], ['distribution', 'Random']].map(([key, label]) => (
          <button key={key} type="button" className={mode === key ? nx.segActive : ''} onClick={() => changeMode(key)}>{label}</button>
        ))}
      </div>
      {mode === 'rate' && (
        <div className={nx.paramHead}>
          <span className={nx.paramLabel}>Vehicles per hour</span>
          <input
            className={styles.numInput}
            type="number"
            min="0"
            step="50"
            value={profile.vehPerHour ?? 0}
            onChange={(e) => setInflow(edge.id, makeRateProfile(Number(e.target.value) || 0))}
          />
          <span className={styles.unit}>veh/h</span>
        </div>
      )}
      {mode === 'function' && <InflowFunctionEditor profile={profile} onChange={(p) => setInflow(edge.id, p)} />}
      {mode === 'distribution' && <InflowDistributionEditor profile={profile} onChange={(p) => setInflow(edge.id, p)} />}
      <div className={nx.paramDetail}>
        {mode === 'rate'
          ? (custom ? '' : `Default: ${config.defaultInflowVphPerLane} veh/h per lane (sidebar). `)
          : `Function and random inflows count cars per step — ${perStepNote}. `}
        {custom && <button type="button" className={nx.linkBtn} onClick={() => setInflow(edge.id, null)}>reset to default</button>}
        {' '}
        <button type="button" className={nx.linkBtn} onClick={applyToAll}>apply this inflow to every feeder</button>
      </div>
    </div>
  );
}

function GatewayPanel({ gateway: g, onSelect }) {
  const { city } = useCityStore();
  const edgeById = new Map(city.edges.map((e) => [e.id, e]));
  const c = gatewayColors(g.role);
  return (
    <>
      <div className={nx.inspectorHead}>
        <span className={nx.kindBadge} style={{ '--badge': c.fill }}>{g.role === 'both' ? 'Source + sink' : g.role === 'source' ? 'Source' : 'Sink'}</span>
        <h3>{g.junctionName || g.roadName || 'Unnamed road'}</h3>
        <div className={nx.inspectorSub}><code>{g.id}</code> · {g.placedAt === 'junction' ? 'first junction outside your area' : 'edge of the download margin'}</div>
      </div>
      {g.feederEdgeIds.length > 0 && (
        <section className={nx.inspectorSection}>
          <h4>Traffic entering here</h4>
          {g.feederEdgeIds.map((id) => <InflowEditor key={id} edge={edgeById.get(id)} />)}
        </section>
      )}
      {g.exitEdgeIds.length > 0 && (
        <section className={nx.inspectorSection}>
          <h4>Traffic leaving here</h4>
          {g.exitEdgeIds.map((id) => {
            const e = edgeById.get(id);
            return (
              <button key={id} type="button" className={nx.roadRow} onClick={() => onSelect({ type: 'road', id: e.roadId })}>
                <span style={{ color: CITY_COLORS.exit }}>➜</span>
                <span className={nx.roadRowName}>from {e.from} ({e.fromArm} arm)</span>
                <span className={nx.muted}>{e.name || 'Unnamed road'} · {formatLength(e.lengthM)}</span>
              </button>
            );
          })}
        </section>
      )}
    </>
  );
}

export default function CityEditPanel({ selection, onSelect }) {
  const { city, snapshot, config } = useCityStore();
  if (!selection || !city) return null;
  const gatewayRole = (id) => city.gateways.find((g) => g.id === id)?.role;
  let body = null;
  if (selection.type === 'intersection') {
    const i = city.intersections.find((x) => x.id === selection.id);
    if (i) body = <IntersectionPanel intersection={i} snapshot={snapshot} onSelect={onSelect} stepSeconds={config.stepSeconds} />;
  } else if (selection.type === 'road') {
    const r = city.roads.find((x) => x.id === selection.id);
    if (r) body = <RoadPanel road={r} snapshot={snapshot} onSelect={onSelect} stepSeconds={config.stepSeconds} gatewayRole={gatewayRole} />;
  } else if (selection.type === 'gateway') {
    const g = city.gateways.find((x) => x.id === selection.id);
    if (g) body = <GatewayPanel gateway={g} onSelect={onSelect} />;
  }
  if (!body) return null;
  return (
    <aside className={nx.inspector}>
      <button type="button" className={nx.closeBtn} onClick={() => onSelect(null)} aria-label="Close panel">×</button>
      {body}
    </aside>
  );
}
