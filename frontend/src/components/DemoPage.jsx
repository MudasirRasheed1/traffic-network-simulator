import React, { useState, useEffect, useRef } from 'react';
import { Link, useLocation, useNavigate } from 'react-router-dom';
import { useCityStore } from '../store/useCityStore.js';
import { deriveCity } from '../network/cityModel.js';
import Logo from './Logo.jsx';
import GridVisualization from './GridVisualization.jsx';
import StatsDashboard from './StatsDashboard.jsx';
import { useSimStore } from '../store/useSimStore.js';
import {
  makeConstantInflowProfile,
  makeDefaultFunctionConfig
} from '../simulation/arrivalProfile.js';
import styles from './DemoPage.module.css';
import SiteHeader from './common/SiteHeader.jsx';
import { HEADINGS, InflowChart, PhaseTimeline } from './demo/DemoWidgets.jsx';

const DEMO_SCENARIOS = [
  {
    id: 'asymmetric_surge',
    num: 1,
    title: 'Adaptive Real-Time Signal Control',
    badge: 'REAL-TIME POLICY ADAPTABILITY',
    badgeColor: '#38bdf8',
    scenarioDescription: 'Heavy asymmetric commuter traffic enters from one single direction (North corridor) while cross-streets remain virtually empty.',
    modelBenefit: 'Demonstrates that our control policy is fully adaptable: rather than adhering to rigid fixed cycles, it monitors live queues in real time, holding green lights where demand exists and skipping idle lanes to eliminate wasted green time.',
    metric: 'Dynamic Policy Adaptability',
    parameters: [
      { label: 'Grid Size', value: '3 × 3' },
      { label: 'Inflow', value: 'North: 7 | S/E/W: 0' },
      { label: 'Duration', value: '200 steps' }
    ],
    configurator: (store) => {
      store.updateConfig({
        gridSize: 3,
        simDuration: 200,
        fixedCycleInterval: 5,
        greedyDecisionInterval: 5,
        defaultRoadSpeed: 2,
        defaultRoadLength: 12,
        defaultBoundaryInflowProfiles: {
          N: makeConstantInflowProfile(7),
          S: makeConstantInflowProfile(0),
          E: makeConstantInflowProfile(0),
          W: makeConstantInflowProfile(0),
        }
      });
    },
    // Vector Artwork for Card 1
    renderArtwork: () => (
      <svg className={styles.cardSvg} viewBox="0 0 320 160" fill="none" xmlns="http://www.w3.org/2000/svg">
        <rect width="320" height="160" rx="8" fill="#090d16" />
        <line x1="160" y1="10" x2="160" y2="150" stroke="#1e293b" strokeWidth="24" strokeLinecap="round" />
        <line x1="20" y1="80" x2="300" y2="80" stroke="#1e293b" strokeWidth="24" strokeLinecap="round" />
        <circle cx="160" cy="80" r="18" fill="#0f172a" stroke="#38bdf8" strokeWidth="2" />
        {/* Surge Flow Indicators from North */}
        <line x1="160" y1="20" x2="160" y2="70" stroke="#38bdf8" strokeWidth="6" strokeDasharray="6 4" />
        <rect x="156" y="24" width="8" height="12" rx="2" fill="#38bdf8" />
        <rect x="156" y="42" width="8" height="12" rx="2" fill="#38bdf8" />
        <rect x="156" y="60" width="8" height="12" rx="2" fill="#38bdf8" />
        {/* Green Light indicator on NS */}
        <circle cx="160" cy="80" r="6" fill="#22c55e" />
        <text x="180" y="48" fill="#38bdf8" fontSize="10" fontFamily="monospace" fontWeight="bold">HEAVY INFLOW (7 veh/s)</text>
        <text x="200" y="100" fill="#64748b" fontSize="9" fontFamily="monospace">IDLE LANES (0 veh/s)</text>
      </svg>
    )
  },
  {
    id: 'waveform_oscillation',
    num: 2,
    title: 'Time-Varying Traffic Waves & Dynamic Adaptation',
    badge: 'INFLOW AS A FUNCTION OF TIME',
    badgeColor: '#a78bfa',
    scenarioDescription: 'Traffic volume continuously shifts throughout the day in undulating waves, peaking during rush-hour crests and dropping during off-peak intervals.',
    modelBenefit: 'We model traffic as a continuous wave function over time, and our policy dynamically adapts: it automatically expands green phase durations during peak wave crests and contracts them during troughs.',
    metric: 'Time-Variant Wave Tracking',
    parameters: [
      { label: 'Grid Size', value: '3 × 3' },
      { label: 'Inflow', value: 'Sinusoidal Wave' },
      { label: 'Duration', value: '200 steps' }
    ],
    configurator: (store) => {
      const waveProfile = {
        mode: 'function',
        constantValue: 0,
        functionConfig: {
          profileType: 'sinCos',
          params: {
            ...makeDefaultFunctionConfig().params,
            sinCosOffset: 4,
            sinCosA: 3,
            sinCosB: 0,
            sinCosPeriod: 24,
            sinCosPhaseUnit: 'rad',
            sinCosPhi: 0,
          }
        }
      };
      store.updateConfig({
        gridSize: 3,
        simDuration: 200,
        fixedCycleInterval: 5,
        greedyDecisionInterval: 5,
        defaultRoadSpeed: 2,
        defaultRoadLength: 12,
        defaultBoundaryInflowProfiles: {
          N: waveProfile,
          S: waveProfile,
          E: waveProfile,
          W: waveProfile,
        }
      });
    },
    // Vector Artwork for Card 2
    renderArtwork: () => (
      <svg className={styles.cardSvg} viewBox="0 0 320 160" fill="none" xmlns="http://www.w3.org/2000/svg">
        <rect width="320" height="160" rx="8" fill="#090d16" />
        {/* Grid lines */}
        <line x1="30" y1="130" x2="290" y2="130" stroke="#1e293b" strokeWidth="1.5" />
        <line x1="30" y1="20" x2="30" y2="130" stroke="#1e293b" strokeWidth="1.5" />
        {/* Sine Wave Curve */}
        <path
          d="M 30 80 Q 75 20, 115 80 T 200 80 T 285 80"
          fill="none"
          stroke="#a78bfa"
          strokeWidth="3"
        />
        {/* Wave Peaks */}
        <circle cx="75" cy="40" r="5" fill="#c084fc" stroke="#ffffff" strokeWidth="1.5" />
        <circle cx="160" cy="40" r="5" fill="#c084fc" stroke="#ffffff" strokeWidth="1.5" />
        <circle cx="245" cy="40" r="5" fill="#c084fc" stroke="#ffffff" strokeWidth="1.5" />
        <text x="45" y="30" fill="#a78bfa" fontSize="9" fontFamily="monospace" fontWeight="bold">Rush-Hour Wave Peak</text>
        <text x="175" y="118" fill="#64748b" fontSize="9" fontFamily="monospace">Off-Peak Trough</text>
        <text x="35" y="145" fill="#94a3b8" fontSize="8.5" fontFamily="monospace">q(t) = a · sin(ωt) + b</text>
      </svg>
    )
  },
  {
    id: 'stochastic_bursts',
    num: 3,
    title: 'Multi-Distribution Randomness & Stochastic Modeling',
    badge: 'RANDOMNESS & PROBABILITY DISTRIBUTIONS',
    badgeColor: '#f59e0b',
    scenarioDescription: 'We model real-world traffic randomness using multiple probability distributions and arrival methods. In this live demo, inflow randomness is modeled using a Normal distribution with mean (μ = 4) and standard deviation (σ = 1.5).',
    modelBenefit: 'Demonstrates our ability to simulate realistic traffic randomness across multiple distributions, proving how our adaptive signal control dynamically balances green lights when stochastic arrival clusters occur.',
    metric: 'Randomness Modeling (Demo: Normal μ=4, σ=1.5)',
    parameters: [
      { label: 'Grid Size', value: '3 × 3' },
      { label: 'Inflow', value: 'Normal Distribution (μ = 4, σ = 1.5)' },
      { label: 'Duration', value: '200 steps' }
    ],
    configurator: (store) => {
      const normalProfile = {
        mode: 'distribution',
        constantValue: 0,
        distributionConfig: {
          distributionType: 'normal',
          seed: 42,
          params: {
            mean: 4,
            stdDev: 1.5,
          }
        }
      };
      store.updateConfig({
        gridSize: 3,
        simDuration: 200,
        fixedCycleInterval: 5,
        greedyDecisionInterval: 5,
        defaultRoadSpeed: 2,
        defaultRoadLength: 12,
        defaultBoundaryInflowProfiles: {
          N: normalProfile,
          S: normalProfile,
          E: normalProfile,
          W: normalProfile,
        }
      });
    },
    // Vector Artwork for Card 3: Normal Bell Curve
    renderArtwork: () => (
      <svg className={styles.cardSvg} viewBox="0 0 320 160" fill="none" xmlns="http://www.w3.org/2000/svg">
        <rect width="320" height="160" rx="8" fill="#090d16" />
        {/* Baseline Axis */}
        <line x1="30" y1="130" x2="290" y2="130" stroke="#1e293b" strokeWidth="1.5" />
        <line x1="160" y1="20" x2="160" y2="130" stroke="#1e293b" strokeWidth="1" strokeDasharray="3 3" />
        
        {/* Normal Distribution Sample Bars */}
        <rect x="70" y="120" width="16" height="10" fill="#334155" rx="2" />
        <rect x="92" y="105" width="16" height="25" fill="#334155" rx="2" />
        <rect x="114" y="75" width="16" height="55" fill="#334155" rx="2" />
        <rect x="136" y="45" width="16" height="85" fill="#f59e0b" rx="2" />
        <rect x="158" y="38" width="16" height="92" fill="#f59e0b" rx="2" />
        <rect x="180" y="55" width="16" height="75" fill="#f59e0b" rx="2" />
        <rect x="202" y="85" width="16" height="45" fill="#334155" rx="2" />
        <rect x="224" y="110" width="16" height="20" fill="#334155" rx="2" />
        <rect x="246" y="122" width="16" height="8" fill="#334155" rx="2" />

        {/* Bell Curve Line */}
        <path
          d="M 50 128 C 90 128, 120 120, 140 60 C 150 30, 170 30, 180 60 C 200 120, 230 128, 270 128"
          fill="none"
          stroke="#f59e0b"
          strokeWidth="2.5"
        />

        <text x="120" y="24" fill="#f59e0b" fontSize="9" fontFamily="monospace" fontWeight="bold">Normal Bell Curve (μ=4, σ=1.5)</text>
        <text x="35" y="145" fill="#94a3b8" fontSize="8.5" fontFamily="monospace">Real-Time Queue Clearing</text>
      </svg>
    )
  },
  {
    id: 'real_world_kinematics',
    num: 4,
    title: 'High-Fidelity Real-World Grid & Full Configurability',
    badge: 'REAL-WORLD FIDELITY & CONFIGURATION',
    badgeColor: '#2dd4bf',
    scenarioDescription: 'Real city networks have varied road lengths, differing speed limits, turn splits, and strict lane capacities.',
    modelBenefit: 'Our model reflects real-world road networks: you can easily configure grid dimensions, road lengths, speed limits, vehicle turn directions, and traffic volume for every road approach.',
    metric: 'Fully Configurable Network',
    parameters: [
      { label: 'Grid Size', value: '3 × 3' },
      { label: 'Road Length', value: '16 units' },
      { label: 'Road Speed', value: '3 units/step' },
      { label: 'Boundary Inflows', value: 'N/E: 5 | S/W: 4' },
      { label: 'Turn Split', value: '60% Straight | 20% Right | 20% Left' },
      { label: 'Departure Rate', value: '3 veh/step' },
      { label: 'Decision Interval', value: '5 steps' },
      { label: 'Duration', value: '200 steps' }
    ],
    configurator: (store) => {
      store.updateConfig({
        gridSize: 3,
        simDuration: 200,
        fixedCycleInterval: 5,
        greedyDecisionInterval: 5,
        defaultRoadSpeed: 3,
        defaultRoadLength: 16,
        defaultTurnProbT: 0.6,
        defaultTurnProbR: 0.2,
        defaultTurnProbL: 0.2,
        defaultDepartureRate: 3,
        defaultBoundaryInflowProfiles: {
          N: makeConstantInflowProfile(5),
          S: makeConstantInflowProfile(4),
          E: makeConstantInflowProfile(5),
          W: makeConstantInflowProfile(4),
        }
      });
    },
    // Vector Artwork for Card 4
    renderArtwork: () => (
      <svg className={styles.cardSvg} viewBox="0 0 320 160" fill="none" xmlns="http://www.w3.org/2000/svg">
        <rect width="320" height="160" rx="8" fill="#090d16" />
        {/* Multi-node Road Grid */}
        <line x1="50" y1="45" x2="270" y2="45" stroke="#1e293b" strokeWidth="12" strokeLinecap="round" />
        <line x1="50" y1="115" x2="270" y2="115" stroke="#1e293b" strokeWidth="12" strokeLinecap="round" />
        <line x1="90" y1="20" x2="90" y2="140" stroke="#1e293b" strokeWidth="12" strokeLinecap="round" />
        <line x1="230" y1="20" x2="230" y2="140" stroke="#1e293b" strokeWidth="12" strokeLinecap="round" />
        {/* Intersections */}
        <circle cx="90" cy="45" r="10" fill="#0f172a" stroke="#2dd4bf" strokeWidth="2" />
        <circle cx="230" cy="45" r="10" fill="#0f172a" stroke="#2dd4bf" strokeWidth="2" />
        <circle cx="90" cy="115" r="10" fill="#0f172a" stroke="#2dd4bf" strokeWidth="2" />
        <circle cx="230" cy="115" r="10" fill="#0f172a" stroke="#2dd4bf" strokeWidth="2" />
        {/* Short Link indicator */}
        <line x1="90" y1="58" x2="90" y2="102" stroke="#2dd4bf" strokeWidth="3" />
        <text x="105" y="85" fill="#2dd4bf" fontSize="9" fontFamily="monospace" fontWeight="bold">Configurable Dimensions & Speeds</text>
        <text x="110" y="32" fill="#94a3b8" fontSize="8.5" fontFamily="monospace">Custom Inflow & Outgoing Rates</text>
      </svg>
    )
  }
];

// ---------------------------------------------------------------
// Start here: four short stages
// ---------------------------------------------------------------

// What each Watch run shows, in a few words.
const FEATURES = {
  asymmetric_surge: {
    title: 'Adapts to live queues',
    short: 'One busy road, three quiet ones.',
    run: 'Heavy traffic comes from the north only. Greedy keeps the busy road green; Fixed keeps cycling through empty roads.',
  },
  waveform_oscillation: {
    title: 'Traffic that changes over time',
    short: 'Inflow rises and falls like a wave.',
    run: 'Traffic on every side follows the wave in the chart. Greedy gives more green at the peaks, less in the dips.',
  },
  stochastic_bursts: {
    title: 'Random traffic',
    short: 'Arrivals drawn from a probability distribution.',
    run: 'Cars arrive at random each step (Normal distribution, mean 4). The chart shows the bursts Greedy has to absorb.',
  },
  real_world_kinematics: {
    title: 'A fully configurable network',
    short: 'Road length, speed, turns and inflow per road.',
    run: 'Longer, faster roads, a different turn mix and uneven inflow. Every one of these settings can be changed.',
    showParams: true,
  },
};

const PRACTICE_STEPS = 150;

function configurePractice(store, flows, active) {
  const rate = (key) => (active.has(key) ? flows[key] : 0);
  store.updateConfig({
    gridSize: 3,
    simDuration: PRACTICE_STEPS,
    seed: 2,
    fixedCycleInterval: 5,
    greedyDecisionInterval: 5,
    defaultRoadLength: 12,
    defaultRoadSpeed: 2,
    defaultTurnProbT: 0.7,
    defaultTurnProbR: 0.15,
    defaultTurnProbL: 0.15,
    defaultBoundaryInflowProfiles: Object.fromEntries(HEADINGS.map((h) => [h.side, makeConstantInflowProfile(rate(h.key))])),
  });
}

function PracticePanel({ flows, active, onToggle, onFlow }) {
  return (
    <div className={styles.practicePanel}>
      <div className={styles.practiceDirections}>
        <span className={styles.practiceLabel}>Traffic direction</span>
        <div className={styles.directionButtons}>
          {HEADINGS.map((h) => (
            <button
              key={h.key}
              type="button"
              className={active.has(h.key) ? styles.directionOn : ''}
              style={{ '--c': h.color }}
              onClick={() => onToggle(h.key)}
            >
              {h.label}
            </button>
          ))}
        </div>
      </div>
      <div className={styles.practiceControls}>
        {HEADINGS.filter((h) => active.has(h.key)).map((h) => (
          <label key={h.key}>
            <span>{h.label}: <strong>{flows[h.key]}</strong> cars per step on each road</span>
            <input type="range" min="1" max="8" value={flows[h.key]} style={{ accentColor: h.color }} onChange={(e) => onFlow(h.key, Number(e.target.value))} />
          </label>
        ))}
        {!active.size && <p className={styles.practiceHint}>Pick at least one direction.</p>}
      </div>
    </div>
  );
}

export default function DemoPage() {
  const navigate = useNavigate();
  const loadCity = useCityStore((s) => s.loadCity);
  const [selectedScenarioIdx, setSelectedScenarioIdx] = useState(null);
  const [practice, setPractice] = useState(false);
  const [flows, setFlows] = useState({ south: 3, north: 3, west: 3, east: 3 });
  const [active, setActive] = useState(() => new Set(['south']));
  const [cell, setCell] = useState([1, 1]);
  const [cityError, setCityError] = useState('');

  const isRunning = useSimStore((s) => s.isRunning);
  const isPaused = useSimStore((s) => s.isPaused);
  const speed = useSimStore((s) => s.speed);
  const snapshot = useSimStore((s) => s.snapshot);
  const engine = useSimStore((s) => s.engine);
  const setSpeed = useSimStore((s) => s.setSpeed);
  const startSimulation = useSimStore((s) => s.startSimulation);
  const pauseSimulation = useSimStore((s) => s.pauseSimulation);
  const resumeSimulation = useSimStore((s) => s.resumeSimulation);
  const initSimulation = useSimStore((s) => s.initSimulation);
  const stepOnce = useSimStore((s) => s.stepOnce);
  const stepBackOnce = useSimStore((s) => s.stepBackOnce);

  // Opening Start here again (for example from the header) shows the
  // four stages, not the run that was open.
  const location = useLocation();
  useEffect(() => {
    setSelectedScenarioIdx(null);
    setPractice(false);
  }, [location.key]);

  // The phase each policy chose at every intersection, step by step.
  const historyRef = useRef([]);
  useEffect(() => {
    const h = historyRef.current;
    if (!snapshot) { h.length = 0; return; }
    if (snapshot.time === 0 || snapshot.time < h.length - 1) h.length = 0;
    const phases = (pol) => snapshot[pol].grid.map((row) => row.map((i) => i.currentPhase));
    h[snapshot.time] = { fixed: phases('fixed'), greedy: phases('greedy') };
  }, [snapshot]);

  const handleSelectScenario = (idx) => {
    setSelectedScenarioIdx(idx);
    setPractice(false);
    const sc = DEMO_SCENARIOS[idx];
    const store = useSimStore.getState();
    sc.configurator(store);
    store.resetSimulation();
    store.initSimulation();
    store.startSimulation();
  };

  const handleBackToCards = () => {
    useSimStore.getState().resetSimulation();
    setSelectedScenarioIdx(null);
    setPractice(false);
  };

  const runPractice = (nextFlows, nextActive) => {
    const store = useSimStore.getState();
    configurePractice(store, nextFlows, nextActive);
    store.resetSimulation();
    store.setSpeed(25);
    if (!nextActive.size) return;
    store.initSimulation();
    store.startSimulation();
  };
  const startPractice = () => {
    setPractice(true);
    setSelectedScenarioIdx(null);
    runPractice(flows, active);
  };
  const toggleDirection = (key) => {
    const next = new Set(active);
    if (next.has(key)) next.delete(key); else next.add(key);
    setActive(next);
    runPractice(flows, next);
  };
  const changeFlow = (key, value) => {
    const next = { ...flows, [key]: value };
    setFlows(next);
    runPractice(next, active);
  };

  // Real city: a sample network loaded into the City Simulator.
  const openRealCity = async () => {
    setCityError('');
    try {
      const sample = await (await fetch('/samples/chandigarh-sector17.json')).json();
      loadCity(deriveCity(sample.base), sample.meta);
      navigate('/city-sim');
    } catch {
      setCityError('The sample city could not be loaded. Try again.');
    }
  };

  const activeScenario = selectedScenarioIdx !== null ? DEMO_SCENARIOS[selectedScenarioIdx] : null;
  const feature = activeScenario ? FEATURES[activeScenario.id] : null;
  const inSimulation = activeScenario || practice;
  const stages = [
    { n: 1, title: 'Watch', text: 'Get to know the simulator and its main features.', action: () => document.getElementById('watch')?.scrollIntoView({ behavior: 'smooth' }) },
    { n: 2, title: 'Practice', text: 'Make yourself familiar with the controls.', action: startPractice },
    { n: 3, title: 'Explore', text: 'Build your own grid.', action: () => navigate('/simulator') },
    { n: 4, title: 'Real city', text: 'Run it on a real city.', action: openRealCity },
  ];

  return (
    <div className={styles.pageWrapper}>
      <SiteHeader />

      <main className={styles.mainContainer}>
        {!inSimulation ? (
          <div className={styles.overviewSection}>
            <div className={styles.introHero}>
              <h1>Start here</h1>
              <p>Four short steps from watching to your own city.</p>
            </div>

            <div className={styles.stageGrid}>
              {stages.map((st) => (
                <button key={st.n} type="button" className={styles.stageCard} onClick={st.action}>
                  <span className={styles.stageNum}>{st.n}</span>
                  <strong>{st.title}</strong>
                  <span>{st.text}</span>
                </button>
              ))}
            </div>
            {cityError && <p className={styles.stageError}>{cityError}</p>}

            <div>
              <h2 id="watch" className={styles.stageHeading}>1. Watch</h2>
              <p className={styles.stageLead}>What we built, in four short live runs. Each compares a fixed signal cycle with our Greedy policy.</p>
            </div>
            <div className={styles.featureGrid}>
              {DEMO_SCENARIOS.map((sc, idx) => (
                <button key={sc.id} type="button" className={styles.featureCard} onClick={() => handleSelectScenario(idx)}>
                  <div className={styles.featureArt}>{sc.renderArtwork()}</div>
                  <div className={styles.featureBody}>
                    <span className={styles.featureNum}>Feature {sc.num}</span>
                    <strong>{FEATURES[sc.id].title}</strong>
                    <span>{FEATURES[sc.id].short}</span>
                    <span className={styles.featureRun}>Run it</span>
                  </div>
                </button>
              ))}
            </div>
          </div>
        ) : (
          <div className={styles.simulationSection}>
            <div className={styles.simTopBar}>
              <button className={styles.backToCardsBtn} onClick={handleBackToCards}>
                <svg className={styles.backIcon} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M19 12H5M12 19l-7-7 7-7"/>
                </svg>
                <span>Back to Start here</span>
              </button>

              <div className={styles.activeScenarioInfo}>
                <span className={styles.scenarioHeading}>
                  {activeScenario ? <>Feature {activeScenario.num}: <strong>{feature.title}</strong></> : <strong>2. Practice</strong>}
                </span>
              </div>

              <div className={styles.simControlsGroup}>
                {isRunning ? (
                  <button className={`${styles.btn} ${styles.btnPause}`} onClick={pauseSimulation}>Stop</button>
                ) : isPaused ? (
                  <>
                    <button className={`${styles.btn} ${styles.btnResume}`} onClick={resumeSimulation}>Resume</button>
                    <button className={`${styles.btn} ${styles.btnStep}`} onClick={stepBackOnce} disabled={!snapshot || snapshot.time <= 0}>Prev Step</button>
                    <button className={`${styles.btn} ${styles.btnStep}`} onClick={stepOnce}>Next Step</button>
                  </>
                ) : (
                  <button className={`${styles.btn} ${styles.btnStart}`} onClick={() => { initSimulation(); startSimulation(); }} disabled={practice && !active.size}>
                    Start Simulation
                  </button>
                )}
                <button className={`${styles.btn} ${styles.btnReset}`} onClick={() => (practice ? runPractice(flows, active) : handleSelectScenario(selectedScenarioIdx))}>
                  Reset
                </button>
                <div className={styles.speedControl}>
                  <label>Speed:</label>
                  <input type="range" min="1" max="60" value={speed} onChange={(e) => setSpeed(parseInt(e.target.value, 10))} />
                  <span>{speed} steps/s</span>
                </div>
              </div>
            </div>

            <p className={styles.runLine}>
              {activeScenario ? feature.run : 'Choose where traffic comes from and how much. Then watch how each policy switches its lights.'}
            </p>

            {practice && (
              <PracticePanel flows={flows} active={active} onToggle={toggleDirection} onFlow={changeFlow} />
            )}

            {feature?.showParams && (
              <div className={styles.activeParamsSummaryBar}>
                <div className={styles.paramsPillsList}>
                  {activeScenario.parameters.map((param, pIdx) => (
                    <span key={pIdx} className={styles.paramPill}>
                      <strong className={styles.paramKey}>{param.label}:</strong> {param.value}
                    </span>
                  ))}
                </div>
              </div>
            )}

            <InflowChart engine={engine} time={snapshot?.time ?? 0} />

            <div className={styles.visualizationContainer}>
              <GridVisualization />
            </div>

            {practice && snapshot && (
              <PhaseTimeline history={historyRef.current} gridSize={3} steps={PRACTICE_STEPS} cell={cell} onCell={setCell} />
            )}

            <div className={styles.dashboardContainer}>
              <StatsDashboard />
            </div>

            <div className={styles.ctaBox}>
              <div className={styles.ctaInfo}>
                <h3>{practice ? 'Next: build your own grid' : 'Next: try it yourself'}</h3>
              </div>
              {practice
                ? <Link to="/simulator" className={styles.ctaButton}>Open the Grid Simulator</Link>
                : <button type="button" className={styles.ctaButton} onClick={startPractice}>Go to Practice</button>}
            </div>
          </div>
        )}
      </main>

      <footer className={styles.footer}>
        <div className={styles.footerLinks}>
          <Link to="/" className={styles.footerLink}>Home</Link>
          <span className={styles.footerDot}>•</span>
          <Link to="/docs" className={styles.footerLink}>Documentation</Link>
          <span className={styles.footerDot}>•</span>
          <Link to="/contact" className={styles.footerLink}>Contact Us</Link>
        </div>
      </footer>
    </div>
  );
}
