import React, { useState, useEffect } from 'react';
import { Link } from 'react-router-dom';
import Logo from './Logo.jsx';
import GridVisualization from './GridVisualization.jsx';
import StatsDashboard from './StatsDashboard.jsx';
import { useSimStore } from '../store/useSimStore.js';
import {
  makeConstantInflowProfile,
  makeDefaultFunctionConfig
} from '../simulation/arrivalProfile.js';
import styles from './DemoPage.module.css';

const DEMO_SCENARIOS = [
  {
    id: 'asymmetric_surge',
    num: 1,
    title: 'Adaptive Real-Time Signal Control',
    badge: 'REAL-TIME POLICY ADAPTABILITY',
    badgeColor: '#38bdf8',
    scenarioDescription: 'Heavy asymmetric commuter traffic enters from one single direction (North corridor) while cross-streets remain virtually empty.',
    modelBenefit: 'Demonstrates that our control policy is fully adaptable: rather than adhering to rigid fixed cycles, it monitors live queue weights in real-time, holding green lights where demand exists and skipping idle approaches to eliminate wasted green time.',
    metric: 'Dynamic Policy Adaptability',
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
    scenarioDescription: 'Traffic volume continuously shifts throughout the day in undulating waves—peaking during rush-hour crests and dropping during off-peak intervals.',
    modelBenefit: 'We model traffic mathematically as a continuous function of time q(t), and our policy dynamically adapts: it automatically expands green phase durations during peak wave crests and contracts them during troughs.',
    metric: 'Time-Variant Wave Tracking',
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
    title: 'Randomness & Multi-Distribution Modeling',
    badge: 'STOCHASTIC UNCERTAINTY (POISSON MODEL)',
    badgeColor: '#f59e0b',
    scenarioDescription: 'Vehicles arrive with inherent real-world randomness, creating sudden uncoordinated cluster spikes from stadium exits, train pickups, or diversions.',
    modelBenefit: 'We model traffic randomness by supporting multiple probability distributions (including Poisson, Zero-Inflated, and Gaussian burst models), proving how our algorithm computes marginal pressure to dissipate random cluster shockwaves.',
    metric: 'Poisson & Multi-Distribution Modeling',
    configurator: (store) => {
      const burstProfile = {
        mode: 'function',
        constantValue: 0,
        functionConfig: {
          profileType: 'pulseTrain',
          params: {
            ...makeDefaultFunctionConfig().params,
            pulseBase: 1,
            pulsePeak: 7,
            pulseEvery: 14,
            pulseWidth: 3,
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
          N: burstProfile,
          S: burstProfile,
          E: burstProfile,
          W: burstProfile,
        }
      });
    },
    // Vector Artwork for Card 3
    renderArtwork: () => (
      <svg className={styles.cardSvg} viewBox="0 0 320 160" fill="none" xmlns="http://www.w3.org/2000/svg">
        <rect width="320" height="160" rx="8" fill="#090d16" />
        {/* Baseline Axis */}
        <line x1="30" y1="130" x2="290" y2="130" stroke="#1e293b" strokeWidth="1.5" />
        {/* Stochastic Bar Distribution */}
        <rect x="50" y="105" width="12" height="25" fill="#334155" rx="2" />
        <rect x="70" y="115" width="12" height="15" fill="#334155" rx="2" />
        {/* Sudden Cluster Burst */}
        <rect x="90" y="35" width="18" height="95" fill="#f59e0b" rx="2" />
        <rect x="114" y="55" width="18" height="75" fill="#f59e0b" rx="2" />
        <rect x="140" y="100" width="12" height="30" fill="#334155" rx="2" />
        <rect x="160" y="110" width="12" height="20" fill="#334155" rx="2" />
        {/* Second Burst */}
        <rect x="185" y="45" width="18" height="85" fill="#f59e0b" rx="2" />
        <rect x="210" y="115" width="12" height="15" fill="#334155" rx="2" />
        <rect x="230" y="105" width="12" height="25" fill="#334155" rx="2" />
        <text x="85" y="25" fill="#f59e0b" fontSize="9" fontFamily="monospace" fontWeight="bold">Random Poisson Burst (λ=7)</text>
        <text x="35" y="145" fill="#94a3b8" fontSize="8.5" fontFamily="monospace">Marginal Pressure Dissipation (ΔQ)</text>
      </svg>
    )
  },
  {
    id: 'real_world_kinematics',
    num: 4,
    title: 'High-Fidelity Real-World Grid & Full Configurability',
    badge: 'REAL-WORLD FIDELITY & CONFIGURATION',
    badgeColor: '#2dd4bf',
    scenarioDescription: 'Real city networks have heterogeneous road dimensions, short block distances, differing speed limits, and strict per-lane storage capacities.',
    modelBenefit: 'Our model is close to the real world: you can configure input inflow rates, road lengths, grid dimensions, vehicle speeds, turn probabilities, and outgoing departure rates for all approaches to prevent short-link spillback and deadlocks.',
    metric: 'Fully Configurable Dimensions & In/Out Rates',
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

export default function DemoPage() {
  const [selectedScenarioIdx, setSelectedScenarioIdx] = useState(null);

  const isRunning = useSimStore((s) => s.isRunning);
  const isPaused = useSimStore((s) => s.isPaused);
  const speed = useSimStore((s) => s.speed);
  const snapshot = useSimStore((s) => s.snapshot);
  const setSpeed = useSimStore((s) => s.setSpeed);
  const startSimulation = useSimStore((s) => s.startSimulation);
  const pauseSimulation = useSimStore((s) => s.pauseSimulation);
  const resumeSimulation = useSimStore((s) => s.resumeSimulation);
  const resetSimulation = useSimStore((s) => s.resetSimulation);
  const initSimulation = useSimStore((s) => s.initSimulation);
  const stepOnce = useSimStore((s) => s.stepOnce);
  const stepBackOnce = useSimStore((s) => s.stepBackOnce);

  const handleSelectScenario = (idx) => {
    setSelectedScenarioIdx(idx);
    const sc = DEMO_SCENARIOS[idx];
    const store = useSimStore.getState();
    sc.configurator(store);
    store.initSimulation();
    store.startSimulation();
  };

  const handleBackToCards = () => {
    useSimStore.getState().resetSimulation();
    setSelectedScenarioIdx(null);
  };

  const activeScenario = selectedScenarioIdx !== null ? DEMO_SCENARIOS[selectedScenarioIdx] : null;

  return (
    <div className={styles.pageWrapper}>
      {/* Header */}
      <header className={styles.header}>
        <div className={styles.headerLeft}>
          <div className={styles.navRow}>
            <Link to="/" className={styles.backBtn} title="Return to Home">
              <svg className={styles.backIcon} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                <path d="M19 12H5M12 19l-7-7 7-7"/>
              </svg>
              <span>Back to Home</span>
            </Link>
            <span className={styles.breadcrumbSep}>/</span>
            <span className={styles.breadcrumbCurrent}>Interactive Demos</span>
          </div>
          <Link to="/" className={styles.logoLink}>
            <Logo size="medium" subtitle="Interactive Pre-Configured Benchmark Scenarios" />
          </Link>
        </div>

        <nav className={styles.toolbar}>
          <Link to="/" className={styles.toolbarBtn}>Home</Link>
          <Link to="/docs" className={styles.toolbarBtn}>Documentation</Link>
          <Link to="/contact" className={styles.toolbarBtn}>Contact Us</Link>
          <Link to="/#auth-section" className={styles.primaryToolbarBtn}>Sign In / Access</Link>
        </nav>
      </header>

      {/* Main Container */}
      <main className={styles.mainContainer}>
        {/* STAGE 1: 4 Large Visual Cards Overview */}
        {selectedScenarioIdx === null ? (
          <div className={styles.overviewSection}>
            <div className={styles.introHero}>
              <div className={styles.badgeLabel}>PLATFORM BENCHMARKS</div>
              <h1>Select a Live Simulation Scenario</h1>
              <p>
                Click any card to launch the actual multi-intersection simulation engine and inspect live comparative performance graphs.
              </p>
            </div>

            <div className={styles.cardsGrid}>
              {DEMO_SCENARIOS.map((sc, idx) => (
                <div
                  key={sc.id}
                  className={styles.scenarioCard}
                  onClick={() => handleSelectScenario(idx)}
                >
                  {/* Artwork Illustration Banner */}
                  <div className={styles.artworkContainer}>
                    {sc.renderArtwork()}
                  </div>

                  <div className={styles.cardContent}>
                    <div className={styles.cardHeader}>
                      <span className={styles.cardIndex}>Scenario {sc.num}</span>
                      <span
                        className={styles.cardBadge}
                        style={{ color: sc.badgeColor, borderColor: `${sc.badgeColor}55`, background: `${sc.badgeColor}15` }}
                      >
                        {sc.badge}
                      </span>
                    </div>

                    <h2 className={styles.cardTitle}>{sc.title}</h2>

                    <div className={styles.scenarioSection}>
                      <span className={styles.sectionLabel}>TRAFFIC SCENARIO:</span>
                      <p className={styles.scenarioText}>{sc.scenarioDescription}</p>
                    </div>

                    <div className={styles.benefitSection}>
                      <span className={styles.benefitLabel}>SIMULATION MODEL BENEFIT:</span>
                      <p className={styles.benefitText}>{sc.modelBenefit}</p>
                    </div>

                    <div className={styles.cardFooter}>
                      <span className={styles.metricPill}>{sc.metric}</span>
                      <button className={styles.launchBtn}>
                        <span>Run Live Demo</span>
                        <svg className={styles.launchIcon} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                          <line x1="5" y1="12" x2="19" y2="12"></line>
                          <polyline points="12 5 19 12 12 19"></polyline>
                        </svg>
                      </button>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </div>
        ) : (
          /* STAGE 2: Live Full Simulation Run with Grid and Graphs */
          <div className={styles.simulationSection}>
            {/* Top Control Bar */}
            <div className={styles.simTopBar}>
              <button className={styles.backToCardsBtn} onClick={handleBackToCards}>
                <svg className={styles.backIcon} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M19 12H5M12 19l-7-7 7-7"/>
                </svg>
                <span>Back to All Scenarios</span>
              </button>

              <div className={styles.activeScenarioInfo}>
                <span
                  className={styles.cardBadge}
                  style={{ color: activeScenario.badgeColor, borderColor: `${activeScenario.badgeColor}55`, background: `${activeScenario.badgeColor}15` }}
                >
                  {activeScenario.badge}
                </span>
                <span className={styles.scenarioHeading}>
                  Scenario {activeScenario.num}: <strong>{activeScenario.title}</strong>
                </span>
              </div>

              {/* Simulation Player Controls */}
              <div className={styles.simControlsGroup}>
                {isRunning ? (
                  <button className={`${styles.btn} ${styles.btnPause}`} onClick={pauseSimulation}>
                    Stop
                  </button>
                ) : isPaused ? (
                  <>
                    <button className={`${styles.btn} ${styles.btnResume}`} onClick={resumeSimulation}>
                      Resume
                    </button>
                    <button className={`${styles.btn} ${styles.btnStep}`} onClick={stepBackOnce} disabled={!snapshot || snapshot.time <= 0}>
                      Prev Step
                    </button>
                    <button className={`${styles.btn} ${styles.btnStep}`} onClick={stepOnce}>
                      Next Step
                    </button>
                  </>
                ) : (
                  <button className={`${styles.btn} ${styles.btnStart}`} onClick={() => {
                    initSimulation();
                    startSimulation();
                  }}>
                    Start Simulation
                  </button>
                )}

                <button className={`${styles.btn} ${styles.btnReset}`} onClick={() => {
                  const store = useSimStore.getState();
                  activeScenario.configurator(store);
                  store.resetSimulation();
                  store.initSimulation();
                  store.startSimulation();
                }}>
                  Reset
                </button>

                <div className={styles.speedControl}>
                  <label>Speed:</label>
                  <input
                    type="range"
                    min="1"
                    max="60"
                    value={speed}
                    onChange={(e) => setSpeed(parseInt(e.target.value, 10))}
                  />
                  <span>{speed} steps/s</span>
                </div>
              </div>
            </div>

            {/* Actual Full Grid Visualization */}
            <div className={styles.visualizationContainer}>
              <GridVisualization />
            </div>

            {/* Actual Live Graphs & Analytics Dashboard */}
            <div className={styles.dashboardContainer}>
              <StatsDashboard />
            </div>

            {/* Bottom Call to Action */}
            <div className={styles.ctaBox}>
              <div className={styles.ctaInfo}>
                <h3>Ready to build custom topologies and export data?</h3>
                <p>Sign in to configure N x N topologies, import real OpenStreetMap maps, and save benchmark runs to PostgreSQL.</p>
              </div>
              <Link to="/#auth-section" className={styles.ctaButton}>
                Sign In to Build Custom Runs
              </Link>
            </div>
          </div>
        )}
      </main>

      {/* Footer */}
      <footer className={styles.footer}>
        <div className={styles.footerLinks}>
          <Link to="/" className={styles.footerLink}>Home</Link>
          <span className={styles.footerDot}>•</span>
          <Link to="/docs" className={styles.footerLink}>Documentation</Link>
          <span className={styles.footerDot}>•</span>
          <Link to="/contact" className={styles.footerLink}>Contact Us</Link>
        </div>
        <p>© 2026 Traffic Simulator. Developed for Plaksha Advanced Traffic Research Systems.</p>
      </footer>
    </div>
  );
}
