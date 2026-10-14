import { useEffect, useState } from 'react';
import { useCityStore } from '../../store/useCityStore.js';
import CityReasoningModal from './CityReasoningModal.jsx';
import { armDepartureRate, defaultTurnProbs, effectiveLink, inflowFor, sourceLinks } from '../../simulation/cityNetwork.js';
import { makeConstantInflowProfile, makeDefaultDistributionConfig } from '../../simulation/arrivalProfile.js';
import { ROAD_CLASSES } from '../../network/roadDefaults.js';
import { haversineM, pointAlong, polylineLengthM } from '../../network/geo.js';
import {
  ARM_DIRS, addReverseLink, continuationsOf, deleteLink, deleteNode, mergeNodes, setContinuation, setNodeKind, setTurnAllowed, splitRoadAt, updateLink, updateNode,
} from '../../network/cityModel.js';
import { InflowFunctionEditor, InflowDistributionEditor, cloneProfile } from '../ConfigPanel.jsx';
import { GridDiagram } from '../network/CityInspector.jsx';
import { CITY_COLORS, gatewayColors } from '../network/scenes.js';
import { formatLength } from '../network/networkStyle.js';
import nx from '../network/NetworkExplorer.module.css';
import styles from './CitySimulator.module.css';

const DIR_NAMES = { N: 'North', E: 'East', S: 'South', W: 'West' };
const TURN_FIELDS = [['T', 'Through (T)'], ['R', 'Right (R)'], ['L', 'Left (L)']];
const KIND_LABEL = { intersection: 'intersection', junction: 'junction', gateway: 'source/sink' };
const MERGE_RANGE_M = 300;

// A grid-style override input: empty means "use the default" shown as placeholder.
function OverrideField({ label, value, placeholder, onChange, min = 0, max, step = 1, disabled }) {
  return (
    <label className={`${styles.ovField} ${value != null && !disabled ? styles.ovEdited : ''} ${disabled ? styles.ovOff : ''}`}>
      <span>{label}</span>
      <input
        type="number"
        min={min}
        max={max}
        step={step}
        placeholder={disabled ? '' : String(placeholder)}
        value={disabled ? '' : value ?? ''}
        disabled={disabled}
        onChange={(e) => {
          if (e.target.value === '') return onChange(null);
          const v = Number(e.target.value);
          if (!Number.isFinite(v) || v < min || (max != null && v > max)) return;
          onChange(v);
        }}
      />
    </label>
  );
}

function ComputedField({ label, value }) {
  return (
    <div className={styles.ovField}>
      <span>{label}</span>
      <div className={styles.ovComputed}>{value}</div>
    </div>
  );
}

function SelectField({ label, value, options, onChange }) {
  return (
    <label className={styles.ovField}>
      <span>{label}</span>
      <select value={value ?? ''} onChange={(e) => onChange(e.target.value)}>
        {options.map(([key, text]) => <option key={key} value={key}>{text}</option>)}
      </select>
    </label>
  );
}

// Name of a node or road: saved when the field loses focus or Enter is pressed.
function NameField({ value, placeholder, onCommit }) {
  const [text, setText] = useState(value || '');
  useEffect(() => setText(value || ''), [value]);
  const commit = () => { if ((text || '') !== (value || '')) onCommit(text.trim() || null); };
  return (
    <input
      className={styles.nameInput}
      value={text}
      placeholder={placeholder}
      onChange={(e) => setText(e.target.value)}
      onBlur={commit}
      onKeyDown={(e) => { if (e.key === 'Enter') e.target.blur(); }}
      aria-label="Name"
    />
  );
}

function SectionTitle({ children, onReset }) {
  return (
    <h4 className={styles.ovTitle}>
      {children}
      {onReset && <button type="button" className={nx.linkBtn} onClick={onReset}>Reset</button>}
    </h4>
  );
}

function NodeChip({ id, onSelect }) {
  const city = useCityStore((st) => st.city);
  const gateway = city.gateways.find((g) => g.id === id);
  const junction = !gateway && city.junctions.some((j) => j.id === id);
  const color = gateway ? gatewayColors(gateway.role).fill : junction ? CITY_COLORS.junction : CITY_COLORS.intersection;
  return (
    <button type="button" className={nx.junctionChip} onClick={() => onSelect({ type: gateway ? 'gateway' : junction ? 'junction' : 'intersection', id })}>
      <span style={{ background: color, borderRadius: gateway ? 2 : '50%' }} />
      {id}
    </button>
  );
}

function LiveCompare({ fixed, greedy }) {
  return (
    <div className={styles.liveCompare}>
      <div><span className={styles.dotFixed} />Fixed: {fixed}</div>
      <div><span className={styles.dotGreedy} />Greedy: {greedy}</div>
    </div>
  );
}

// Turning ratios T/R/L of one arm. Turns that do not exist are disabled.
function TurnFields({ intersectionId, arm, available }) {
  const { overrides, config, setTurnOverride } = useCityStore();
  const defaults = defaultTurnProbs(config);
  const current = overrides.turns?.[intersectionId]?.[arm] || null;
  return (
    <div className={styles.ovGrid3}>
      {TURN_FIELDS.map(([turn, label]) => (
        <OverrideField
          key={turn}
          label={label}
          value={current ? current[turn] : null}
          placeholder={defaults[turn]}
          min={0}
          max={1}
          step={0.05}
          disabled={!available[turn]}
          onChange={(v) => {
            const next = { ...(current || defaults), [turn]: v ?? defaults[turn] };
            const same = TURN_FIELDS.every(([t]) => next[t] === defaults[t]);
            setTurnOverride(intersectionId, arm, same ? null : next);
          }}
        />
      ))}
    </div>
  );
}

const turnsAvailable = (intersection, arm) => Object.fromEntries(['L', 'T', 'R'].map((turn) => [
  turn,
  Boolean(intersection.movements.find((m) => m.from === arm && m.turn === turn)?.allowed),
]));

// Inflow of one source road: Default, Constant, Function or Distribution, as in the grid.
function InflowFields({ link, label }) {
  const { inflows, config, setInflow, city } = useCityStore();
  const custom = inflows[link.id];
  const base = () => cloneProfile(inflowFor(link, city, config, {}));
  const profile = custom ? cloneProfile(custom) : base();
  const mode = custom ? profile.mode : 'default';

  const changeMode = (next) => {
    const b = base();
    if (next === 'default') setInflow(link.id, null);
    else if (next === 'constant') setInflow(link.id, makeConstantInflowProfile(b.mode === 'constant' ? b.constantValue ?? 1 : 1));
    else if (next === 'distribution') setInflow(link.id, { ...b, mode: 'distribution', distributionConfig: b.distributionConfig || makeDefaultDistributionConfig() });
    else setInflow(link.id, { ...b, mode: 'function' });
  };

  return (
    <div className={styles.ovBlock}>
      <div className={styles.ovGrid2}>
        <label className={`${styles.ovField} ${custom ? styles.ovEdited : ''}`}>
          <span>{label}</span>
          <select value={mode} onChange={(e) => changeMode(e.target.value)}>
            <option value="default">Default</option>
            <option value="constant">Constant</option>
            <option value="function">Function</option>
            <option value="distribution">Distribution</option>
          </select>
        </label>
        {mode === 'constant' && (
          <label className={`${styles.ovField} ${styles.ovEdited}`}>
            <span>Rate (cars/step)</span>
            <input
              type="number"
              min="0"
              value={profile.constantValue ?? 0}
              onChange={(e) => setInflow(link.id, { ...profile, constantValue: Math.max(0, Math.floor(Number(e.target.value) || 0)) })}
            />
          </label>
        )}
        {mode === 'default' && <ComputedField label="Rate (cars/step)" value={profile.mode === 'constant' ? profile.constantValue : profile.mode} />}
      </div>
      {mode === 'function' && <InflowFunctionEditor profile={profile} onChange={(p) => setInflow(link.id, p)} />}
      {mode === 'distribution' && <InflowDistributionEditor profile={profile} onChange={(p) => setInflow(link.id, p)} />}
    </div>
  );
}

// ---------------------------------------------------------------
// Edit actions shared by every kind of node
// ---------------------------------------------------------------
function NodeActions({ node, kind, onSelect, tools }) {
  const { city, editModel } = useCityStore();
  const others = city.model.nodes
    .filter((n) => n.id !== node.id)
    .map((n) => ({ n, d: haversineM(node.lat, node.lon, n.lat, n.lon) }))
    .filter((x) => x.d <= MERGE_RANGE_M)
    .sort((a, b) => a.d - b.d)
    .slice(0, 8);
  const convert = (to) => {
    const id = editModel((m) => setNodeKind(m, node.id, to));
    onSelect(id ? { type: to, id } : null);
  };
  return (
    <section className={nx.inspectorSection}>
      <SectionTitle>Edit</SectionTitle>
      <div className={styles.actionRow}>
        <button type="button" className={nx.secondaryBtn} onClick={() => tools.startRoad(node.id)}>Add road from here</button>
        <button type="button" className={nx.secondaryBtn} onClick={() => tools.startMove(node.id)}>Move</button>
        {kind === 'intersection' && <button type="button" className={nx.secondaryBtn} onClick={() => convert('junction')}>Remove signal</button>}
        {kind === 'junction' && <button type="button" className={nx.secondaryBtn} onClick={() => convert('intersection')}>Add signal</button>}
        {kind === 'junction' && <button type="button" className={nx.secondaryBtn} onClick={() => convert('gateway')}>Make source/sink</button>}
        {kind === 'gateway' && <button type="button" className={nx.secondaryBtn} onClick={() => convert('junction')}>Make junction</button>}
        <button type="button" className={`${nx.secondaryBtn} ${styles.dangerBtn}`} onClick={() => { editModel((m) => deleteNode(m, node.id)); onSelect(null); }}>Delete</button>
      </div>
      {others.length > 0 && (
        <SelectField
          label="Merge another node into this one"
          value=""
          options={[['', 'Choose a nearby node'], ...others.map(({ n, d }) => [n.id, `${n.id} · ${KIND_LABEL[n.kind]} · ${Math.round(d)} m`])]}
          onChange={(id) => { if (id) editModel((m) => mergeNodes(m, node.id, id)); }}
        />
      )}
    </section>
  );
}

function RoadList({ title, links, describe, onSelect, children }) {
  if (!links.length) return null;
  return (
    <section className={nx.inspectorSection}>
      <SectionTitle>{title}</SectionTitle>
      {links.map((l) => (
        <button key={l.id} type="button" className={nx.roadRow} onClick={() => onSelect({ type: 'road', id: l.roadId })}>
          <span className={nx.compass}>{describe(l).tag}</span>
          <span className={nx.roadRowName}>{describe(l).text}</span>
          <span className={nx.muted}>{formatLength(l.lengthM)}</span>
        </button>
      ))}
      {children}
    </section>
  );
}

// ---------------------------------------------------------------
// Intersection
// ---------------------------------------------------------------
function IntersectionPanel({ intersection: i, snapshot, onSelect, tools }) {
  const [showReasoning, setShowReasoning] = useState(false);
  const { overrides, config, setTurnOverride, setDepartureOverride, city, editModel } = useCityStore();
  const linkById = new Map(city.links.map((l) => [l.id, l]));
  const arms = ARM_DIRS.filter((d) => i.arms[d]);
  const inArms = arms.filter((d) => i.arms[d].inLinkIds.length);
  const liveF = snapshot?.fixed.intersections[i.id];
  const liveG = snapshot?.greedy.intersections[i.id];
  const maxQ = Math.max(1, ...arms.flatMap((d) => [liveF?.queueLengths[d] || 0, liveG?.queueLengths[d] || 0]));
  const manualDeparture = overrides.departure?.[i.id] || {};
  const noManual = { ...overrides, departure: {} };
  const turnEdits = overrides.turns?.[i.id] || {};
  const links = arms.flatMap((d) => [
    ...i.arms[d].inLinkIds.map((id) => ({ link: linkById.get(id), arm: d, end: 'toArm', other: linkById.get(id).from, way: 'in' })),
    ...i.arms[d].outLinkIds.map((id) => ({ link: linkById.get(id), arm: d, end: 'fromArm', other: linkById.get(id).to, way: 'out' })),
  ]);

  return (
    <>
      <div className={nx.inspectorHead}>
        <span className={nx.kindBadge} style={{ '--badge': CITY_COLORS.intersection }}>
          {i.originalKind === 'roundabout' ? 'Roundabout' : `${i.armCount}-arm intersection`}
        </span>
        <NameField value={i.name} placeholder="Unnamed intersection" onCommit={(name) => editModel((m) => updateNode(m, i.id, { name }))} />
        <div className={nx.inspectorSub}><code>{i.id}</code> · {i.phases.length} phases</div>
      </div>
      <section className={nx.inspectorSection}>
        <GridDiagram intersection={i} />
      </section>

      {snapshot && liveF && liveG && (
        <section className={nx.inspectorSection}>
          <SectionTitle>Step {snapshot.time}</SectionTitle>
          <LiveCompare
            fixed={<><strong>{liveF.currentPhase}</strong> · {liveF.totalQueued} queued · {liveF.vehiclesServed} served</>}
            greedy={<><strong>{liveG.currentPhase}</strong> · {liveG.totalQueued} queued · {liveG.vehiclesServed} served</>}
          />
          {arms.map((d) => (
            <div key={d} className={styles.queueBarRow}>
              <span>{d}</span>
              <div className={styles.queueBars}>
                <div className={styles.barFixed} style={{ width: `${((liveF.queueLengths[d] || 0) / maxQ) * 100}%` }}><em>{liveF.queueLengths[d]}</em></div>
                <div className={styles.barGreedy} style={{ width: `${((liveG.queueLengths[d] || 0) / maxQ) * 100}%` }}><em>{liveG.queueLengths[d]}</em></div>
              </div>
            </div>
          ))}
          {snapshot.greedyDecisionData?.[i.id] && (
            <button type="button" className={nx.secondaryBtn} onClick={() => setShowReasoning(true)}>
              Visualize Algorithm Reasoning
            </button>
          )}
          {showReasoning && snapshot.greedyDecisionData?.[i.id] && (
            <CityReasoningModal
              data={snapshot.greedyDecisionData[i.id]}
              intersection={i}
              onClose={() => setShowReasoning(false)}
              greedyDecisionInterval={config.greedyDecisionInterval}
            />
          )}
        </section>
      )}

      {inArms.length > 0 && (
        <section className={nx.inspectorSection}>
          <SectionTitle onReset={Object.keys(manualDeparture).length ? () => inArms.forEach((d) => setDepartureOverride(i.id, d, null)) : null}>
            Departure Rate (vehicles per green step)
          </SectionTitle>
          <div className={styles.ovGrid4}>
            {inArms.map((d) => (
              <OverrideField
                key={d}
                label={DIR_NAMES[d]}
                value={manualDeparture[d] ?? null}
                placeholder={armDepartureRate(i, d, city, config, noManual)}
                min={1}
                onChange={(v) => setDepartureOverride(i.id, d, v == null ? null : Math.max(1, Math.floor(v)))}
              />
            ))}
          </div>
        </section>
      )}

      {inArms.length > 0 && (
        <section className={nx.inspectorSection}>
          <SectionTitle onReset={Object.keys(turnEdits).length ? () => inArms.forEach((d) => setTurnOverride(i.id, d, null)) : null}>
            Turning Ratios
          </SectionTitle>
          {inArms.map((d) => (
            <div key={d} className={styles.ovArmRow}>
              <span className={styles.ovArm}>{d}</span>
              <TurnFields intersectionId={i.id} arm={d} available={turnsAvailable(i, d)} />
            </div>
          ))}
        </section>
      )}

      {i.movements.length > 0 && (
        <section className={nx.inspectorSection}>
          <SectionTitle>Allowed Turns</SectionTitle>
          {inArms.map((from) => (
            <div key={from} className={styles.turnToggleRow}>
              <span className={styles.ovArm}>{from}</span>
              {['L', 'T', 'R'].map((turn) => {
                const m = i.movements.find((x) => x.from === from && x.turn === turn);
                if (!m) return <span key={turn} className={styles.turnNone}>{turn}</span>;
                return (
                  <button
                    key={turn}
                    type="button"
                    className={m.allowed ? styles.turnOn : styles.turnOff}
                    title={`${turn} from ${DIR_NAMES[from]} to ${DIR_NAMES[m.to]}`}
                    onClick={() => editModel((model) => setTurnAllowed(model, i.id, from, m.to, !m.allowed))}
                  >
                    {turn} → {m.to}
                  </button>
                );
              })}
            </div>
          ))}
          <p className={nx.paramDetail}>Click a turn to allow or forbid it.</p>
        </section>
      )}

      {links.length > 0 && (
        <section className={nx.inspectorSection}>
          <SectionTitle>Roads and Arms</SectionTitle>
          {links.map(({ link, arm, end, other, way }) => (
            <div key={`${way}:${link.id}`} className={styles.armRow}>
              <select value={arm} onChange={(e) => editModel((m) => updateLink(m, link.id, { [end]: e.target.value }))} aria-label="Arm">
                {ARM_DIRS.map((d) => <option key={d} value={d}>{d}</option>)}
              </select>
              <button type="button" className={nx.roadRow} onClick={() => onSelect({ type: 'road', id: link.roadId })}>
                <span className={nx.roadRowName}>{way === 'in' ? `From ${other}` : `To ${other}`} · {link.name || 'Unnamed road'}</span>
                <span className={nx.muted}>{formatLength(link.lengthM)}</span>
              </button>
            </div>
          ))}
        </section>
      )}

      <NodeActions node={i} kind="intersection" onSelect={onSelect} tools={tools} />
    </>
  );
}

// ---------------------------------------------------------------
// Road: one card per direction
// ---------------------------------------------------------------
function LinkEditor({ link, snapshot, onSelect, picked }) {
  const { overrides, setLinkOverride, config, city, editModel } = useCityStore();
  const o = overrides.links?.[link.id] || {};
  const eff = effectiveLink(link, overrides.links, config);
  const isGateway = (id) => city.gateways.some((g) => g.id === id);
  const role = isGateway(link.from) ? 'feeder' : isGateway(link.to) ? 'exit' : 'internal';
  const roleLabel = { feeder: 'Inflow road', exit: 'Outflow road', internal: 'Road' }[role];
  const roleColor = { feeder: CITY_COLORS.feeder, exit: CITY_COLORS.exit, internal: CITY_COLORS.road }[role];
  const target = city.intersections.find((x) => x.id === link.to);
  const origin = city.intersections.find((x) => x.id === link.from);
  const targetArm = target && ARM_DIRS.find((d) => target.arms[d]?.inLinkIds.includes(link.id));
  const originArm = origin && ARM_DIRS.find((d) => origin.arms[d]?.outLinkIds.includes(link.id));
  const armOptions = ARM_DIRS.map((d) => [d, DIR_NAMES[d]]);

  return (
    <div className={`${nx.directionCard} ${picked ? styles.pickedCard : ''}`}>
      <div className={nx.directionHead}>
        <NodeChip id={link.from} onSelect={onSelect} />
        <span className={nx.directionArrow}>→</span>
        <NodeChip id={link.to} onSelect={onSelect} />
        <span className={nx.kindBadge} style={{ '--badge': roleColor }}>{roleLabel}</span>
        {link.custom && <span className={nx.tag}>added</span>}
        {Object.keys(o).length > 0 && (
          <button type="button" className={nx.linkBtn} onClick={() => setLinkOverride(link.id, { speedPerStep: null, lengthM: null, lanes: null })}>Reset</button>
        )}
      </div>
      <div className={styles.ovGrid4}>
        <OverrideField label="Speed (m/step)" value={o.speedPerStep ?? null} placeholder={eff.mapSpeedPerStep} min={0.1} step={0.5} onChange={(v) => setLinkOverride(link.id, { speedPerStep: v })} />
        <OverrideField label="Length (m)" value={o.lengthM ?? null} placeholder={Math.round(link.lengthM)} min={1} step={10} onChange={(v) => setLinkOverride(link.id, { lengthM: v })} />
        <OverrideField label="Lanes" value={o.lanes ?? null} placeholder={link.lanes.value} min={1} max={12} onChange={(v) => setLinkOverride(link.id, { lanes: v == null ? null : Math.round(v) })} />
        <ComputedField label="Travel Time" value={`${eff.travelSteps} step${eff.travelSteps === 1 ? '' : 's'}`} />
      </div>
      {(originArm || targetArm) && (
        <div className={styles.ovGrid2}>
          {originArm && <SelectField label={`Leaves ${link.from} by arm`} value={originArm} options={armOptions} onChange={(d) => editModel((m) => updateLink(m, link.id, { fromArm: d }))} />}
          {targetArm && <SelectField label={`Reaches ${link.to} on arm`} value={targetArm} options={armOptions} onChange={(d) => editModel((m) => updateLink(m, link.id, { toArm: d }))} />}
        </div>
      )}
      {targetArm && <TurnFields intersectionId={target.id} arm={targetArm} available={turnsAvailable(target, targetArm)} />}
      {snapshot && (
        <LiveCompare fixed={`${snapshot.fixed.links?.[link.id] ?? 0} driving`} greedy={`${snapshot.greedy.links?.[link.id] ?? 0} driving`} />
      )}
      <button type="button" className={`${nx.linkBtn} ${styles.dangerLink}`} onClick={() => editModel((m) => deleteLink(m, link.id))}>Delete this direction</button>
    </div>
  );
}

function RoadPanel({ road, snapshot, onSelect, pickedLinkId }) {
  const { city, editModel } = useCityStore();
  // The direction that was clicked on the map comes first.
  const links = road.linkIds.map((id) => city.links.find((l) => l.id === id)).sort((a, b) => (b.id === pickedLinkId) - (a.id === pickedLinkId));
  const info = ROAD_CLASSES[links[0].highway] || ROAD_CLASSES.unclassified;
  const insert = (kind) => {
    const [lat, lon] = pointAlong(links[0].coords, polylineLengthM(links[0].coords) / 2);
    const id = editModel((m) => splitRoadAt(m, road.linkIds, lat, lon, kind));
    if (id) onSelect({ type: kind, id });
  };
  return (
    <>
      <div className={nx.inspectorHead}>
        <span className={nx.classChip} style={{ '--chip': info.color }}>{links.every((l) => l.custom) ? 'Added road' : info.label}</span>
        <NameField
          value={links.find((l) => l.name)?.name}
          placeholder="Unnamed road"
          onCommit={(name) => editModel((m) => road.linkIds.reduce((acc, id) => updateLink(acc, id, { name }), m))}
        />
        <div className={nx.inspectorSub}>{formatLength(links[0].lengthM)} · {links.length > 1 ? 'Two-way' : 'One-way'}</div>
      </div>
      <section className={nx.inspectorSection}>
        {links.map((l) => <LinkEditor key={l.id} link={l} snapshot={snapshot} onSelect={onSelect} picked={links.length > 1 && l.id === pickedLinkId} />)}
      </section>
      <section className={nx.inspectorSection}>
        <SectionTitle>Edit</SectionTitle>
        <div className={styles.actionRow}>
          {links.length === 1 && <button type="button" className={nx.secondaryBtn} onClick={() => editModel((m) => addReverseLink(m, links[0].id))}>Add opposite direction</button>}
          <button type="button" className={nx.secondaryBtn} onClick={() => insert('junction')}>Insert junction</button>
          <button type="button" className={nx.secondaryBtn} onClick={() => insert('intersection')}>Insert intersection</button>
          <button
            type="button"
            className={`${nx.secondaryBtn} ${styles.dangerBtn}`}
            onClick={() => { editModel((m) => road.linkIds.reduce((acc, id) => deleteLink(acc, id), m)); onSelect(null); }}
          >
            {links.length > 1 ? 'Delete all directions' : 'Delete road'}
          </button>
        </div>
      </section>
    </>
  );
}

// ---------------------------------------------------------------
// Source / sink
// ---------------------------------------------------------------
function GatewayPanel({ gateway: g, snapshot, onSelect, tools }) {
  const { city, inflows, setAllInflows, config, editModel } = useCityStore();
  const linkById = new Map(city.links.map((l) => [l.id, l]));
  const c = gatewayColors(g.role);
  const entering = sourceLinks(city).filter((l) => l.from === g.id);
  const leaving = g.inLinkIds.map((id) => linkById.get(id));
  const applyToAll = () => {
    const profile = inflows[entering[0].id] || inflowFor(entering[0], city, config, {});
    setAllInflows(Object.fromEntries(sourceLinks(city).map((l) => [l.id, cloneProfile(profile)])));
  };
  const badge = { both: 'Source and sink', source: 'Source', sink: 'Sink', unused: 'Not connected' }[g.role];
  return (
    <>
      <div className={nx.inspectorHead}>
        <span className={nx.kindBadge} style={{ '--badge': g.role === 'unused' ? '#64748b' : c.fill }}>{badge}</span>
        <NameField value={g.junctionName} placeholder={g.roadName || 'Unnamed source/sink'} onCommit={(name) => editModel((m) => updateNode(m, g.id, { name }))} />
        <div className={nx.inspectorSub}><code>{g.id}</code></div>
      </div>
      {entering.length > 0 && (
        <section className={nx.inspectorSection}>
          <SectionTitle>Inflow</SectionTitle>
          {entering.map((l) => <InflowFields key={l.id} link={l} label={`Towards ${l.to}`} />)}
          <button type="button" className={nx.linkBtn} onClick={applyToAll}>Apply to all sources</button>
        </section>
      )}
      <RoadList title="Roads In" links={g.outLinkIds.map((id) => linkById.get(id))} describe={(l) => ({ tag: '→', text: `To ${l.to} · ${l.name || 'Unnamed road'}` })} onSelect={onSelect} />
      <RoadList title="Roads Out" links={leaving} describe={(l) => ({ tag: '←', text: `From ${l.from} · ${l.name || 'Unnamed road'}` })} onSelect={onSelect}>
        {snapshot && (
          <LiveCompare
            fixed={`${leaving.reduce((s, l) => s + (snapshot.fixed.links?.[l.id] ?? 0), 0)} on the way out`}
            greedy={`${leaving.reduce((s, l) => s + (snapshot.greedy.links?.[l.id] ?? 0), 0)} on the way out`}
          />
        )}
      </RoadList>
      <NodeActions node={g} kind="gateway" onSelect={onSelect} tools={tools} />
    </>
  );
}

// ---------------------------------------------------------------
// Junction without signal
// ---------------------------------------------------------------
function JunctionPanel({ junction: j, onSelect, tools }) {
  const { city, editModel } = useCityStore();
  const linkById = new Map(city.links.map((l) => [l.id, l]));
  const into = j.inLinkIds.map((id) => linkById.get(id));
  const outOf = j.outLinkIds.map((id) => linkById.get(id));
  return (
    <>
      <div className={nx.inspectorHead}>
        <span className={nx.kindBadge} style={{ '--badge': CITY_COLORS.junction }}>Junction, no signal</span>
        <NameField value={j.name} placeholder="Unnamed junction" onCommit={(name) => editModel((m) => updateNode(m, j.id, { name }))} />
        <div className={nx.inspectorSub}><code>{j.id}</code> · cars pass without waiting</div>
      </div>
      {into.length > 0 && outOf.length > 0 && (
        <section className={nx.inspectorSection}>
          <SectionTitle>Where Traffic Continues</SectionTitle>
          {into.map((a) => {
            const allowed = new Set(continuationsOf(a, outOf).map((x) => x.link.id));
            return (
              <div key={a.id} className={styles.turnToggleRow}>
                <span className={styles.continueFrom}>From {a.from}</span>
                {outOf.map((b) => (
                  <button
                    key={b.id}
                    type="button"
                    className={allowed.has(b.id) ? styles.turnOn : styles.turnOff}
                    title={`${a.name || 'road'} from ${a.from} continues to ${b.to}`}
                    onClick={() => editModel((m) => setContinuation(m, a.id, b.id, !allowed.has(b.id)))}
                  >
                    → {b.to}
                  </button>
                ))}
              </div>
            );
          })}
          <p className={nx.paramDetail}>Click to allow or forbid a continuation. Traffic splits by lanes.</p>
        </section>
      )}
      <RoadList title="Roads In" links={into} describe={(l) => ({ tag: '→', text: `From ${l.from} · ${l.name || 'Unnamed road'}` })} onSelect={onSelect} />
      <RoadList title="Roads Out" links={outOf} describe={(l) => ({ tag: '←', text: `To ${l.to} · ${l.name || 'Unnamed road'}` })} onSelect={onSelect} />
      <NodeActions node={j} kind="junction" onSelect={onSelect} tools={tools} />
    </>
  );
}

export default function CityEditPanel({ selection, onSelect, tools }) {
  const { city, snapshot } = useCityStore();
  if (!selection || !city) return null;
  let body = null;
  if (selection.type === 'intersection') {
    const i = city.intersections.find((x) => x.id === selection.id);
    if (i) body = <IntersectionPanel intersection={i} snapshot={snapshot} onSelect={onSelect} tools={tools} />;
  } else if (selection.type === 'road') {
    const r = city.roads.find((x) => x.id === selection.id);
    if (r) body = <RoadPanel road={r} snapshot={snapshot} onSelect={onSelect} pickedLinkId={selection.linkId} />;
  } else if (selection.type === 'gateway') {
    const g = city.gateways.find((x) => x.id === selection.id);
    if (g) body = <GatewayPanel gateway={g} snapshot={snapshot} onSelect={onSelect} tools={tools} />;
  } else if (selection.type === 'junction') {
    const j = city.junctions.find((x) => x.id === selection.id);
    if (j) body = <JunctionPanel junction={j} onSelect={onSelect} tools={tools} />;
  }
  if (!body) return null;
  return (
    <aside className={nx.inspector}>
      <button type="button" className={nx.closeBtn} onClick={() => onSelect(null)} aria-label="Close panel">×</button>
      {body}
    </aside>
  );
}
