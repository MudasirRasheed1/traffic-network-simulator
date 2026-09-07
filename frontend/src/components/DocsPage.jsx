import React, { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { api } from '../utils/api.js';
import Logo from './Logo.jsx';
import styles from './DocsPage.module.css';

const DIRECTION_CONFIG = {
  N: { name: 'North', color: '#38bdf8', flow: 'Southbound flow into grid row 0' },
  S: { name: 'South', color: '#a78bfa', flow: 'Northbound flow into grid row N-1' },
  E: { name: 'East', color: '#2dd4bf', flow: 'Westbound flow into grid col N-1' },
  W: { name: 'West', color: '#f472b6', flow: 'Eastbound flow into grid col 0' },
};

// Component to render consistent, architecturally accurate Indian LHD Phase Diagrams
// Component to render consistent, architecturally accurate Indian LHD Phase Diagrams matching reference blueprint
function PhaseDiagramSvg({ phaseKey }) {
  // Coordinates for Indian LHD (Drive on left of median):
  // South incoming (going North): x = 85, exiting South: x = 115
  // North incoming (going South): x = 115, exiting North: x = 85
  // West incoming (going East): y = 85, exiting West: y = 115
  // East incoming (going West): y = 115, exiting East: y = 85

  let flows = [];
  let redStops = [];

  switch (phaseKey) {
    case 'NT_NR':
      redStops = ['N', 'E', 'W'];
      flows = [
        { d: 'M 85 175 L 85 25', arrow: '85,15 79,28 91,28', color: '#22c55e', dashed: false },
        { d: 'M 85 175 C 85 125, 125 85, 175 85', arrow: '185,85 172,79 172,91', color: '#38bdf8', dashed: true }
      ];
      break;

    case 'ST_SR':
      redStops = ['S', 'E', 'W'];
      flows = [
        { d: 'M 115 25 L 115 175', arrow: '115,185 109,172 121,172', color: '#22c55e', dashed: false },
        { d: 'M 115 25 C 115 75, 75 115, 25 115', arrow: '15,115 28,109 28,121', color: '#38bdf8', dashed: true }
      ];
      break;

    case 'ET_ER':
      redStops = ['N', 'S', 'E'];
      flows = [
        { d: 'M 25 85 L 175 85', arrow: '185,85 172,79 172,91', color: '#22c55e', dashed: false },
        { d: 'M 25 85 C 75 85, 115 125, 115 175', arrow: '115,185 109,172 121,172', color: '#38bdf8', dashed: true }
      ];
      break;

    case 'WT_WR':
      redStops = ['N', 'S', 'W'];
      flows = [
        { d: 'M 175 115 L 25 115', arrow: '15,115 28,109 28,121', color: '#22c55e', dashed: false },
        { d: 'M 175 115 C 125 115, 85 75, 85 25', arrow: '85,15 79,28 91,28', color: '#38bdf8', dashed: true }
      ];
      break;

    case 'NT_ST':
      redStops = ['E', 'W'];
      flows = [
        { d: 'M 85 175 L 85 25', arrow: '85,15 79,28 91,28', color: '#22c55e', dashed: false },
        { d: 'M 115 25 L 115 175', arrow: '115,185 109,172 121,172', color: '#22c55e', dashed: false }
      ];
      break;

    case 'ET_WT':
      redStops = ['N', 'S'];
      flows = [
        { d: 'M 25 85 L 175 85', arrow: '185,85 172,79 172,91', color: '#22c55e', dashed: false },
        { d: 'M 175 115 L 25 115', arrow: '15,115 28,109 28,121', color: '#22c55e', dashed: false }
      ];
      break;

    case 'NR_SR':
      redStops = ['E', 'W'];
      flows = [
        // NR: South approach turning right to East (Red/Crimson curve in South-East quadrant)
        { d: 'M 85 175 C 85 125, 125 85, 175 85', arrow: '185,85 172,79 172,91', color: '#f43f5e', dashed: true },
        // SR: North approach turning right to West (Green curve in North-West quadrant)
        { d: 'M 115 25 C 115 75, 75 115, 25 115', arrow: '15,115 28,109 28,121', color: '#10b981', dashed: true }
      ];
      break;

    case 'ER_WR':
      redStops = ['N', 'S'];
      flows = [
        // ER: West approach turning right to South (Blue curve in South-West quadrant)
        { d: 'M 25 85 C 75 85, 115 125, 115 175', arrow: '115,185 109,172 121,172', color: '#3b82f6', dashed: true },
        // WR: East approach turning right to North (Orange/Amber curve in North-East quadrant)
        { d: 'M 175 115 C 125 115, 85 75, 85 25', arrow: '85,15 79,28 91,28', color: '#f59e0b', dashed: true }
      ];
      break;

    default:
      break;
  }

  return (
    <svg className={styles.phaseDiagramSvg} viewBox="0 0 200 200" fill="none">
      {/* Outer Card Background */}
      <rect width="200" height="200" rx="12" fill="#090d16" />

      {/* Asphalt Crossroad Corridors */}
      <rect x="70" y="0" width="60" height="200" fill="#131b2e" />
      <rect x="0" y="70" width="200" height="60" fill="#131b2e" />
      <rect x="70" y="70" width="60" height="60" fill="#0f1626" />

      {/* 4 Corner Straight Bypass Lanes (Asphalt Pavement) */}
      <polygon points="20,70 70,20 85,20 20,85" fill="#131b2e" />
      <polygon points="130,20 180,70 180,85 115,20" fill="#131b2e" />
      <polygon points="180,130 130,180 115,180 180,115" fill="#131b2e" />
      <polygon points="70,180 20,130 20,115 85,180" fill="#131b2e" />

      {/* Dashed Center Dividing Lines */}
      <line x1="100" y1="20" x2="100" y2="70" stroke="#334155" strokeDasharray="3 3" strokeWidth="1.5" />
      <line x1="100" y1="130" x2="100" y2="180" stroke="#334155" strokeDasharray="3 3" strokeWidth="1.5" />
      <line x1="20" y1="100" x2="70" y2="100" stroke="#334155" strokeDasharray="3 3" strokeWidth="1.5" />
      <line x1="130" y1="100" x2="180" y2="100" stroke="#334155" strokeDasharray="3 3" strokeWidth="1.5" />

      {/* Compass Axis Letters */}
      <text x="100" y="16" fill="#64748b" fontSize="9" fontWeight="bold" textAnchor="middle" fontFamily="monospace">N</text>
      <text x="100" y="196" fill="#64748b" fontSize="9" fontWeight="bold" textAnchor="middle" fontFamily="monospace">S</text>
      <text x="190" y="103" fill="#64748b" fontSize="9" fontWeight="bold" textAnchor="middle" fontFamily="monospace">E</text>
      <text x="10" y="103" fill="#64748b" fontSize="9" fontWeight="bold" textAnchor="middle" fontFamily="monospace">W</text>

      {/* Red Stop Bars across blocked incoming approaches */}
      {redStops.includes('N') && <line x1="100" y1="70" x2="130" y2="70" stroke="#ef4444" strokeWidth="3" strokeLinecap="round" />}
      {redStops.includes('S') && <line x1="70" y1="130" x2="100" y2="130" stroke="#ef4444" strokeWidth="3" strokeLinecap="round" />}
      {redStops.includes('W') && <line x1="70" y1="70" x2="70" y2="100" stroke="#ef4444" strokeWidth="3" strokeLinecap="round" />}
      {redStops.includes('E') && <line x1="130" y1="100" x2="130" y2="130" stroke="#ef4444" strokeWidth="3" strokeLinecap="round" />}

      {/* Active Trajectory Flow Paths */}
      {flows.map((flow, i) => (
        <g key={i}>
          <path
            d={flow.d}
            stroke={flow.color}
            strokeWidth="3.5"
            strokeDasharray={flow.dashed ? '6 4' : 'none'}
            fill="none"
            strokeLinecap="round"
          />
          <polygon points={flow.arrow} fill={flow.color} />
        </g>
      ))}
    </svg>
  );
}

// 8 Signal Phases Data (Indian Left-Hand Driving Convention)
const EIGHT_PHASES = [
  {
    key: 'NT_NR',
    name: 'Northbound Through & Northbound Right',
    category: 'SINGLE-APPROACH SPLIT',
    categoryColor: '#38bdf8',
    approach: 'South (Heading North)',
    movements: 'NT (Through to North) + NR (Right turn to East)',
    description: 'Green signal exclusively for the South approach. Vehicles traveling North enter on the left lane (West side) and proceed straight (NT) or turn right across the junction into the East exit lane (NR). Left turns (NL) remain free.',
    fixedCycle: false
  },
  {
    key: 'ST_SR',
    name: 'Southbound Through & Southbound Right',
    category: 'SINGLE-APPROACH SPLIT',
    categoryColor: '#38bdf8',
    approach: 'North (Heading South)',
    movements: 'ST (Through to South) + SR (Right turn to West)',
    description: 'Green signal exclusively for the North approach. Vehicles traveling South enter on the left lane (East side) and proceed straight (ST) or turn right across the junction into the West exit lane (SR). Left turns (SL) remain free.',
    fixedCycle: false
  },
  {
    key: 'ET_ER',
    name: 'Eastbound Through & Eastbound Right',
    category: 'SINGLE-APPROACH SPLIT',
    categoryColor: '#38bdf8',
    approach: 'West (Heading East)',
    movements: 'ET (Through to East) + ER (Right turn to South)',
    description: 'Green signal exclusively for the West approach. Vehicles traveling East enter on the left lane (North side) and proceed straight (ET) or turn right across the junction into the South exit lane (ER). Left turns (EL) remain free.',
    fixedCycle: false
  },
  {
    key: 'WT_WR',
    name: 'Westbound Through & Westbound Right',
    category: 'SINGLE-APPROACH SPLIT',
    categoryColor: '#38bdf8',
    approach: 'East (Heading West)',
    movements: 'WT (Through to West) + WR (Right turn to North)',
    description: 'Green signal exclusively for the East approach. Vehicles traveling West enter on the left lane (South side) and proceed straight (WT) or turn right across the junction into the North exit lane (WR). Left turns (WL) remain free.',
    fixedCycle: false
  },
  {
    key: 'NT_ST',
    name: 'Dual North-South Through Movements',
    category: 'DUAL OPPOSING THROUGH',
    categoryColor: '#22c55e',
    approach: 'North & South Corridors',
    movements: 'NT (Northbound Straight) + ST (Southbound Straight)',
    description: 'Green signal for both opposing North and South through streams simultaneously. In Left-Hand Driving, Northbound traffic travels on the West lane (x=85) and Southbound on the East lane (x=115), flowing straight past each other without intersecting. Right turns remain stopped on red.',
    fixedCycle: true
  },
  {
    key: 'ET_WT',
    name: 'Dual East-West Through Movements',
    category: 'DUAL OPPOSING THROUGH',
    categoryColor: '#22c55e',
    approach: 'East & West Corridors',
    movements: 'ET (Eastbound Straight) + WT (Westbound Straight)',
    description: 'Green signal for both opposing East and West through streams simultaneously. In Left-Hand Driving, Eastbound traffic travels on the North lane (y=85) and Westbound on the South lane (y=115), flowing straight past each other without intersecting. Right turns remain stopped on red.',
    fixedCycle: true
  },
  {
    key: 'NR_SR',
    name: 'Dual North-South Protected Right Turns',
    category: 'DUAL OPPOSING RIGHT TURNS',
    categoryColor: '#a78bfa',
    approach: 'North & South Corridors',
    movements: 'NR (South approach to East) + SR (North approach to West)',
    description: 'Protected green turn phase for North and South right-turners simultaneously. In Left-Hand Driving, Southbound right-turners (from East lane) and Northbound right-turners (from West lane) curve smoothly around the center without intersecting paths.',
    fixedCycle: true
  },
  {
    key: 'ER_WR',
    name: 'Dual East-West Protected Right Turns',
    category: 'DUAL OPPOSING RIGHT TURNS',
    categoryColor: '#a78bfa',
    approach: 'East & West Corridors',
    movements: 'ER (West approach to South) + WR (East approach to North)',
    description: 'Protected green turn phase for East and West right-turners simultaneously. In Left-Hand Driving, Eastbound right-turners (from North lane) and Westbound right-turners (from South lane) curve smoothly around the center without intersecting paths.',
    fixedCycle: true
  }
];

// Inflow function waveforms generator for visual preview
function generateWaveformData(type, amp = 8, period = 20, baseline = 4, totalSteps = 40) {
  const points = [];
  for (let t = 0; t <= totalSteps; t++) {
    let val = 0;
    if (type === 'sine') {
      val = Math.max(0, baseline + amp * Math.sin((2 * Math.PI * t) / period));
    } else if (type === 'square') {
      val = (t % period) < period / 2 ? baseline + amp : baseline;
    } else if (type === 'triangular') {
      const cycle = t % period;
      val = cycle < period / 2
        ? baseline + (2 * amp * cycle) / period
        : baseline + amp - (2 * amp * (cycle - period / 2)) / period;
    } else if (type === 'sawtooth') {
      val = baseline + (amp * (t % period)) / period;
    } else if (type === 'pulse') {
      val = (t % period) < period / 4 ? baseline + amp * 1.5 : baseline;
    } else {
      val = baseline;
    }
    points.push({ t, val: Math.round(val * 10) / 10 });
  }
  return points;
}

export default function DocsPage() {
  const navigate = useNavigate();
  const [activeTab, setActiveTab] = useState('sine');
  const [amp, setAmp] = useState(8);
  const [period, setPeriod] = useState(20);
  const [baseline, setBaseline] = useState(4);

  // Interactive Live Intersection Demo state
  const [demoPhase, setDemoPhase] = useState('NT_ST');
  const [demoQueues, setDemoQueues] = useState({ N: 5, S: 4, E: 8, W: 7 });
  const [demoServed, setDemoServed] = useState(0);
  const [demoCycleStep, setDemoCycleStep] = useState(0);

  const handleLogout = () => {
    api.logout();
    navigate('/');
  };

  // Waveform data for interactive graph
  const waveform = generateWaveformData(activeTab, amp, period, baseline, 40);
  const maxVal = Math.max(...waveform.map((p) => p.val), 20);

  // SVG dimensions
  const svgWidth = 600;
  const svgHeight = 160;
  const padding = 25;
  const graphWidth = svgWidth - padding * 2;
  const graphHeight = svgHeight - padding * 2;

  const polylinePoints = waveform
    .map((p) => {
      const x = padding + (p.t / 40) * graphWidth;
      const y = padding + graphHeight - (p.val / maxVal) * graphHeight;
      return `${x},${y}`;
    })
    .join(' ');

  // Interactive intersection simulation ticker
  const handleStepDemo = () => {
    setDemoCycleStep((prev) => prev + 1);
    setDemoQueues((prev) => {
      const next = { ...prev };
      next.N += Math.random() > 0.4 ? 1 : 0;
      next.S += Math.random() > 0.4 ? 1 : 0;
      next.E += Math.random() > 0.4 ? 1 : 0;
      next.W += Math.random() > 0.4 ? 1 : 0;

      let served = 0;
      if (demoPhase === 'NT_ST') {
        if (next.N > 0) { next.N = Math.max(0, next.N - 2); served += 2; }
        if (next.S > 0) { next.S = Math.max(0, next.S - 2); served += 2; }
      } else if (demoPhase === 'ET_WT') {
        if (next.E > 0) { next.E = Math.max(0, next.E - 2); served += 2; }
        if (next.W > 0) { next.W = Math.max(0, next.W - 2); served += 2; }
      } else if (demoPhase === 'NR_SR') {
        if (next.N > 0) { next.N = Math.max(0, next.N - 1); served += 1; }
        if (next.S > 0) { next.S = Math.max(0, next.S - 1); served += 1; }
      } else if (demoPhase === 'ER_WR') {
        if (next.E > 0) { next.E = Math.max(0, next.E - 1); served += 1; }
        if (next.W > 0) { next.W = Math.max(0, next.W - 1); served += 1; }
      }
      setDemoServed((s) => s + served);
      return next;
    });
  };

  const handleGreedySwitchDemo = () => {
    const nsQ = demoQueues.N + demoQueues.S;
    const ewQ = demoQueues.E + demoQueues.W;
    if (nsQ >= ewQ) {
      setDemoPhase('NT_ST');
    } else {
      setDemoPhase('ET_WT');
    }
  };

  return (
    <div className={styles.docsContainer}>
      {/* Top Header */}
      <header className={styles.header}>
        <div className={styles.headerTop}>
          <div className={styles.headerTitle}>
            <Logo size="medium" subtitle="Technical Architecture, 8 Signal Phases (LHD), & Benchmark Framework" />
          </div>

          <div className={styles.toolbar}>
            <Link to="/" className={styles.toolbarBtn}>Home</Link>
            <Link to="/demo" className={styles.toolbarBtn}>Interactive Demos</Link>
            <Link to="/simulator" className={styles.toolbarBtn}>Simulator</Link>
            <Link to="/saved-simulations" className={styles.toolbarBtn}>Saved Archives</Link>
            <Link to="/docs" className={`${styles.toolbarBtn} ${styles.toolbarBtnActive}`}>Docs</Link>
            <Link to="/contact" className={styles.toolbarBtn}>Contact</Link>
            {api.isAuthenticated() && (
              <button onClick={handleLogout} className={`${styles.toolbarBtn} ${styles.toolbarBtnDanger}`}>
                Log Out
              </button>
            )}
          </div>
        </div>

        {/* Quick-Nav Sticky Pills */}
        <div className={styles.quickNav}>
          <a href="#section-overview" className={styles.navPill}>1. Architecture</a>
          <a href="#section-intersection" className={styles.navPill}>2. Direction Blueprint</a>
          <a href="#section-eight-phases" className={styles.navPill}>3. The 8 Signal Phases (LHD)</a>
          <a href="#section-interactive-demo" className={styles.navPill}>4. Interactive Simulator</a>
          <a href="#section-inflow-sandbox" className={styles.navPill}>5. Inflow Math Sandbox</a>
          <a href="#section-greedy" className={styles.navPill}>6. Greedy Optimization</a>
          <a href="#section-benchmarks" className={styles.navPill}>7. Evaluation KPIs</a>
        </div>
      </header>

      {/* SECTION 1: System Overview */}
      <section id="section-overview" className={styles.section}>
        <div className={styles.sectionHeader}>
          <span className={styles.sectionNumber}>01</span>
          <h2>System Architecture &amp; Experimental Goals</h2>
        </div>
        <p>
          The simulator runs two autonomous traffic management algorithms on strictly identical N × N road networks, subject to identical vehicle injections, speed limits, and turning probabilities.
        </p>

        <div className={styles.architectureGrid}>
          <div className={styles.archCardFixed}>
            <div className={styles.archCardHeader}>
              <span className={styles.policyBadgeFixed}>BASELINE</span>
              <h3>Fixed Cycle Schedule</h3>
            </div>
            <p>
              Pre-timed cyclic controller that alternates 4 green signal phases (NT_ST → ET_WT → NR_SR → ER_WR) in an open-loop round-robin sequence regardless of live queue conditions.
            </p>
            <ul className={styles.specList}>
              <li><strong>Cycle Sequence:</strong> NT_ST → ET_WT → NR_SR → ER_WR</li>
              <li><strong>Adaptability:</strong> Zero response to directional traffic spikes</li>
              <li><strong>Lookahead:</strong> None (Open Loop)</li>
            </ul>
          </div>

          <div className={styles.archCardGreedy}>
            <div className={styles.archCardHeader}>
              <span className={styles.policyBadgeGreedy}>ADAPTIVE</span>
              <h3>Greedy Lookahead Controller</h3>
            </div>
            <p>
              Closed-loop predictive controller that evaluates all 8 possible phase candidates over a forward horizon H and dynamically selects the phase that minimizes total queue backlog and delay.
            </p>
            <ul className={styles.specList}>
              <li><strong>Lookahead Horizon:</strong> H steps forward projection</li>
              <li><strong>Phase Universe:</strong> Can pick any of all 8 phases dynamically</li>
              <li><strong>Optimization:</strong> Multi-objective marginal delay minimization</li>
            </ul>
          </div>
        </div>
      </section>

      {/* SECTION 2: Intersection & Direction Blueprint */}
      <section id="section-intersection" className={styles.section}>
        <div className={styles.sectionHeader}>
          <span className={styles.sectionNumber}>02</span>
          <h2>Perimeter Directions &amp; Intersection Node Blueprint</h2>
        </div>
        <p>
          To maintain visual clarity, the 4 cardinal directions are mapped to distinct non-congestion colors across the entire application:
        </p>

        {/* Visual Direction Grid */}
        <div className={styles.directionGrid}>
          {['N', 'S', 'E', 'W'].map((dir) => {
            const info = DIRECTION_CONFIG[dir];
            return (
              <div key={dir} className={styles.dirCard} style={{ borderTopColor: info.color }}>
                <div className={styles.dirCardTitle} style={{ color: info.color }}>
                  {info.name} Approach
                </div>
                <div className={styles.dirCardFlow}>{info.flow}</div>
                <div className={styles.dirColorTag} style={{ background: `${info.color}22`, color: info.color, borderColor: info.color }}>
                  Indicator: {info.color}
                </div>
              </div>
            );
          })}
        </div>

        {/* Visual Node Anatomy Diagram */}
        <div className={styles.anatomyContainer}>
          <div className={styles.anatomyVisual}>
            <div className={styles.anatomyNode}>
              <div className={styles.anatomyHeader}>
                <span className={styles.anatomyCoord}>(0, 0)</span>
              </div>
              <div className={styles.anatomyCount}>7</div>
              <div className={styles.anatomyPhase}>Phase: NT_ST</div>
              <div className={styles.anatomyBars}>
                <div className={styles.anatomyBar} style={{ background: '#38bdf8' }} title="North: 2" />
                <div className={styles.anatomyBar} style={{ background: '#a78bfa' }} title="South: 3" />
                <div className={styles.anatomyBar} style={{ background: '#2dd4bf' }} title="East: 1" />
                <div className={styles.anatomyBar} style={{ background: '#f472b6' }} title="West: 1" />
              </div>
            </div>
          </div>

          <div className={styles.anatomyExplanation}>
            <h3>Intersection Cell Anatomy</h3>
            <ul className={styles.anatomyList}>
              <li>
                <strong style={{ color: '#cbd5e1' }}>Coordinates (Row, Col):</strong> Identifies the grid matrix position (0,0 is top-left).
              </li>
              <li>
                <strong style={{ color: '#ffffff' }}>Queue Count:</strong> Total queued vehicles currently waiting across all 4 incoming road approaches.
              </li>
              <li>
                <strong style={{ color: '#60a5fa' }}>Active Signal Phase:</strong> The specific movement allowed through the junction.
              </li>
              <li>
                <strong style={{ color: '#38bdf8' }}>4 Approach Indicator Bars:</strong> Live queue backlog on North, South, East, and West respectively.
              </li>
            </ul>
          </div>
        </div>
      </section>

      {/* SECTION 3: The 8 Signal Phases (Indian Left-Hand Driving Convention) */}
      <section id="section-eight-phases" className={styles.section}>
        <div className={styles.sectionHeader}>
          <span className={styles.sectionNumber}>03</span>
          <h2>The 8 Signal Phases (Indian Left-Hand Driving Convention)</h2>
        </div>
        
        <div className={styles.conventionNotice}>
          <div className={styles.conventionIcon}>
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" width="22" height="22">
              <circle cx="12" cy="12" r="10"></circle>
              <line x1="12" y1="16" x2="12" y2="12"></line>
              <line x1="12" y1="8" x2="12.01" y2="8"></line>
            </svg>
          </div>
          <div>
            <strong>Indian Left-Hand Driving (LHD) Rules:</strong>
            <p>
              Vehicles drive on the <strong>left side</strong> of the road. <strong>Left turns (NL, SL, EL, WL)</strong> are free filter turns along the near curb that do not cross opposing traffic lanes and bypass signal constraints. <strong>Right turns (NR, SR, ER, WR)</strong> cross oncoming lanes and require protected green signal phases.
            </p>
          </div>
        </div>

        {/* 8 Phases Grid with Visual Diagrams */}
        <div className={styles.phasesGrid}>
          {EIGHT_PHASES.map((phase) => (
            <div key={phase.key} className={styles.phaseCard}>
              <div className={styles.phaseCardHeader}>
                <div className={styles.phaseKeyBadge}>{phase.key}</div>
                <div
                  className={styles.phaseCategoryBadge}
                  style={{ color: phase.categoryColor, borderColor: `${phase.categoryColor}44`, background: `${phase.categoryColor}15` }}
                >
                  {phase.category}
                </div>
              </div>

              {/* Visual SVG Diagram */}
              <div className={styles.diagramContainer}>
                <PhaseDiagramSvg phaseKey={phase.key} />
              </div>

              <div className={styles.phaseDetails}>
                <h3 className={styles.phaseName}>{phase.name}</h3>
                
                <div className={styles.movementSpecs}>
                  <div className={styles.specRow}>
                    <span className={styles.specKey}>Approach:</span>
                    <span className={styles.specVal}>{phase.approach}</span>
                  </div>
                  <div className={styles.specRow}>
                    <span className={styles.specKey}>Green Movements:</span>
                    <span className={styles.specValGreen}>{phase.movements}</span>
                  </div>
                  <div className={styles.specRow}>
                    <span className={styles.specKey}>Fixed Cycle:</span>
                    <span className={phase.fixedCycle ? styles.specValFixed : styles.specValGreedyOnly}>
                      {phase.fixedCycle ? 'Used in Fixed Cycle (4-Phase)' : 'Adaptive Controller Dynamic Selection'}
                    </span>
                  </div>
                </div>

                <p className={styles.phaseDesc}>{phase.description}</p>
              </div>
            </div>
          ))}
        </div>
      </section>

      {/* SECTION 4: Live Interactive Demo */}
      <section id="section-interactive-demo" className={styles.section}>
        <div className={styles.sectionHeader}>
          <span className={styles.sectionNumber}>04</span>
          <h2>Live Interactive 4-Way Intersection Simulator</h2>
        </div>
        <p>
          Click the interactive buttons below to test how phase switching drains queues and how the Greedy controller picks the highest-priority phase:
        </p>

        <div className={styles.interactiveDemoWrapper}>
          <div className={styles.demoVisualArea}>
            <div className={styles.crossroadBox}>
              <div className={styles.approachNorth}>
                <span style={{ color: '#38bdf8' }}>North: {demoQueues.N}</span>
                <div className={`${styles.trafficLight} ${demoPhase === 'NT_ST' || demoPhase === 'NR_SR' ? styles.lightGreen : styles.lightRed}`} />
              </div>

              <div className={styles.middleRow}>
                <div className={styles.approachWest}>
                  <span style={{ color: '#f472b6' }}>West: {demoQueues.W}</span>
                  <div className={`${styles.trafficLight} ${demoPhase === 'ET_WT' || demoPhase === 'ER_WR' ? styles.lightGreen : styles.lightRed}`} />
                </div>

                <div className={styles.junctionCenter}>
                  <span className={styles.activePhaseIndicator}>
                    PHASE: {demoPhase}
                  </span>
                  <span className={styles.stepCounter}>Step #{demoCycleStep}</span>
                </div>

                <div className={styles.approachEast}>
                  <div className={`${styles.trafficLight} ${demoPhase === 'ET_WT' || demoPhase === 'ER_WR' ? styles.lightGreen : styles.lightRed}`} />
                  <span style={{ color: '#2dd4bf' }}>East: {demoQueues.E}</span>
                </div>
              </div>

              <div className={styles.approachSouth}>
                <div className={`${styles.trafficLight} ${demoPhase === 'NT_ST' || demoPhase === 'NR_SR' ? styles.lightGreen : styles.lightRed}`} />
                <span style={{ color: '#a78bfa' }}>South: {demoQueues.S}</span>
              </div>
            </div>
          </div>

          <div className={styles.demoControlPanel}>
            <h3>Interactive Phase Controller</h3>
            <div className={styles.demoKpiRow}>
              <div className={styles.demoKpi}>
                <span>Total Waiting:</span>
                <strong>{demoQueues.N + demoQueues.S + demoQueues.E + demoQueues.W} cars</strong>
              </div>
              <div className={styles.demoKpi}>
                <span>Vehicles Served:</span>
                <strong style={{ color: '#34d399' }}>{demoServed}</strong>
              </div>
            </div>

            <div className={styles.demoButtons}>
              <button
                className={`${styles.demoBtn} ${demoPhase === 'NT_ST' ? styles.demoBtnActive : ''}`}
                onClick={() => setDemoPhase('NT_ST')}
              >
                Set Phase: NT_ST (Dual North-South Through)
              </button>
              <button
                className={`${styles.demoBtn} ${demoPhase === 'ET_WT' ? styles.demoBtnActive : ''}`}
                onClick={() => setDemoPhase('ET_WT')}
              >
                Set Phase: ET_WT (Dual East-West Through)
              </button>
              <button
                className={`${styles.demoBtn} ${demoPhase === 'NR_SR' ? styles.demoBtnActive : ''}`}
                onClick={() => setDemoPhase('NR_SR')}
              >
                Set Phase: NR_SR (Dual N-S Right Turns)
              </button>
              <button
                className={`${styles.demoBtn} ${demoPhase === 'ER_WR' ? styles.demoBtnActive : ''}`}
                onClick={() => setDemoPhase('ER_WR')}
              >
                Set Phase: ER_WR (Dual E-W Right Turns)
              </button>
              <button className={`${styles.demoBtn} ${styles.demoBtnGreedy}`} onClick={handleGreedySwitchDemo}>
                Auto Greedy Switch (Pick Highest Backlog)
              </button>
              <button className={`${styles.demoBtn} ${styles.demoBtnStep}`} onClick={handleStepDemo}>
                + Advance Simulation Step
              </button>
            </div>
          </div>
        </div>
      </section>

      {/* SECTION 5: Inflow Function Sandbox */}
      <section id="section-inflow-sandbox" className={styles.section}>
        <div className={styles.sectionHeader}>
          <span className={styles.sectionNumber}>05</span>
          <h2>Boundary Inflow Mathematical Sandbox</h2>
        </div>
        <p>
          Boundary inflow controls the rate at which vehicles arrive at the perimeter of the city grid. Choose a mathematical model to see the live generated injection curve:
        </p>

        {/* Function Type Selector Tabs */}
        <div className={styles.functionTabs}>
          {[
            { id: 'sine', label: 'Sine Wave (Periodic Rush Hour)' },
            { id: 'square', label: 'Square Wave (Bursty)' },
            { id: 'triangular', label: 'Triangular (Gradual Ramp)' },
            { id: 'sawtooth', label: 'Sawtooth (Sudden Drop)' },
            { id: 'pulse', label: 'Pulse Train (Intermittent)' },
            { id: 'constant', label: 'Constant Flow' },
          ].map((tab) => (
            <button
              key={tab.id}
              className={`${styles.funcTabBtn} ${activeTab === tab.id ? styles.funcTabActive : ''}`}
              onClick={() => setActiveTab(tab.id)}
            >
              {tab.label}
            </button>
          ))}
        </div>

        {/* Live SVG Graph */}
        <div className={styles.graphContainer}>
          <div className={styles.graphHeader}>
            <span>Live Generated Waveform q(t) (Cars Injected vs Simulation Step)</span>
            <span className={styles.formulaText}>
              {activeTab === 'sine' && `q(t) = max(0, floor(${baseline} + ${amp} * sin(2*pi*t / ${period})))`}
              {activeTab === 'square' && `q(t) = t % ${period} < ${period / 2} ? ${baseline + amp} : ${baseline}`}
              {activeTab === 'triangular' && `q(t) = triangular(t, period=${period}, amp=${amp})`}
              {activeTab === 'sawtooth' && `q(t) = ${baseline} + (${amp} * (t % ${period}) / ${period})`}
              {activeTab === 'pulse' && `q(t) = pulseTrain(t, burst=${baseline + amp * 1.5})`}
              {activeTab === 'constant' && `q(t) = ${baseline} cars/step`}
            </span>
          </div>

          <svg className={styles.waveformSvg} viewBox={`0 0 ${svgWidth} ${svgHeight}`}>
            <line x1={padding} y1={padding} x2={padding} y2={svgHeight - padding} stroke="#334155" strokeWidth="1" />
            <line x1={padding} y1={svgHeight - padding} x2={svgWidth - padding} y2={svgHeight - padding} stroke="#334155" strokeWidth="1" />
            <line x1={padding} y1={padding + graphHeight / 2} x2={svgWidth - padding} y2={padding + graphHeight / 2} stroke="#1e293b" strokeDasharray="4 4" strokeWidth="1" />
            <polyline fill="none" stroke="#38bdf8" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" points={polylinePoints} />
            <text x={padding + 4} y={padding + 12} fill="#94a3b8" fontSize="10" fontFamily="monospace">Max: {Math.round(maxVal)} cars/step</text>
            <text x={svgWidth - padding - 40} y={svgHeight - padding + 16} fill="#94a3b8" fontSize="10" fontFamily="monospace">t = 40</text>
            <text x={padding} y={svgHeight - padding + 16} fill="#94a3b8" fontSize="10" fontFamily="monospace">t = 0</text>
          </svg>

          {/* Sliders */}
          <div className={styles.sliderGrid}>
            <div className={styles.sliderGroup}>
              <label>Amplitude (a): <strong>{amp}</strong></label>
              <input type="range" min="1" max="25" value={amp} onChange={(e) => setAmp(parseInt(e.target.value, 10))} />
            </div>
            <div className={styles.sliderGroup}>
              <label>Period (T steps): <strong>{period}</strong></label>
              <input type="range" min="6" max="40" value={period} onChange={(e) => setPeriod(parseInt(e.target.value, 10))} />
            </div>
            <div className={styles.sliderGroup}>
              <label>Baseline (b): <strong>{baseline}</strong></label>
              <input type="range" min="0" max="15" value={baseline} onChange={(e) => setBaseline(parseInt(e.target.value, 10))} />
            </div>
          </div>
        </div>
      </section>

      {/* SECTION 6: Greedy Lookahead Algorithm */}
      <section id="section-greedy" className={styles.section}>
        <div className={styles.sectionHeader}>
          <span className={styles.sectionNumber}>06</span>
          <h2>The Greedy Lookahead Optimization Formulation</h2>
        </div>
        <p>
          At each decision point t, the Greedy Lookahead Controller evaluates all 8 possible signal phase candidates by simulating forward for H steps and computing the objective penalty J(p):
        </p>

        {/* Math Block */}
        <div className={styles.mathBlock}>
          <div className={styles.mathFormula}>
            J(p) = w_veh * N_total(p) + w_wait * W_sum(p) + w_delay * D_accum(p)
          </div>
          <div className={styles.mathFormulaDesc}>
            Optimal Phase: p* = argmin J(p)
          </div>
        </div>

        <div className={styles.weightsGrid}>
          <div className={styles.weightCard}>
            <span className={styles.weightTag}>w_veh</span>
            <h4>Vehicle Count Weight</h4>
            <p>Penalizes the total number of vehicles remaining queued in the intersection approach lanes after H lookahead steps.</p>
          </div>
          <div className={styles.weightCard}>
            <span className={styles.weightTag}>w_wait</span>
            <h4>Waiting Time Weight</h4>
            <p>Penalizes the cumulative waiting time spent by vehicles idling at red lights to prevent approach starvation.</p>
          </div>
          <div className={styles.weightCard}>
            <span className={styles.weightTag}>w_delay</span>
            <h4>Delay Accumulation Weight</h4>
            <p>Penalizes deviations from free-flow travel speed, giving high priority to clearing bottlenecked high-speed corridors.</p>
          </div>
        </div>
      </section>

      {/* SECTION 7: Benchmark Metrics & KPIs */}
      <section id="section-benchmarks" className={styles.section}>
        <div className={styles.sectionHeader}>
          <span className={styles.sectionNumber}>07</span>
          <h2>Performance Evaluation &amp; Benchmark Metrics</h2>
        </div>
        <p>
          Compare performance metrics between Fixed Cycle and Greedy Adaptive to assess efficiency gains:
        </p>

        <div className={styles.kpiExplainerGrid}>
          <div className={styles.kpiExplainerCard}>
            <div className={styles.kpiTitleRow}>
              <h4>Network Throughput</h4>
              <span className={styles.higherBetter}>Higher is Better</span>
            </div>
            <p>Total count of vehicles that have successfully completed their route and exited the boundary perimeters of the network.</p>
          </div>

          <div className={styles.kpiExplainerCard}>
            <div className={styles.kpiTitleRow}>
              <h4>Average Vehicle Delay</h4>
              <span className={styles.lowerBetter}>Lower is Better</span>
            </div>
            <p>Average time lost per vehicle waiting at red lights compared to an uninterrupted free-flow traversal through the grid.</p>
          </div>

          <div className={styles.kpiExplainerCard}>
            <div className={styles.kpiTitleRow}>
              <h4>In-Network Backlog</h4>
              <span className={styles.lowerBetter}>Lower is Better</span>
            </div>
            <p>Instantaneous snapshot of active vehicles still travelling on road segments or queued at intersection signals.</p>
          </div>

          <div className={styles.kpiExplainerCard}>
            <div className={styles.kpiTitleRow}>
              <h4>Win/Loss Intersection Heatmap</h4>
              <span className={styles.deltaTag}>Relative Delta</span>
            </div>
            <p>Visual map highlighting nodes where the Greedy controller achieved shorter queue lengths (Green) vs baseline schedule (Amber/Red).</p>
          </div>
        </div>
      </section>
    </div>
  );
}
