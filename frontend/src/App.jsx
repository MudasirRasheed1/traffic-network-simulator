import React, { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { useSimStore } from './store/useSimStore.js';
import { api } from './utils/api.js';
import ConfigPanel from './components/ConfigPanel.jsx';
import GridVisualization from './components/GridVisualization.jsx';
import MapCorrespondencePanel from './components/MapCorrespondencePanel.jsx';
import ImportedNotes from './components/ImportedNotes.jsx';
import ErrorBoundary from './components/ErrorBoundary.jsx';
import StatsDashboard from './components/StatsDashboard.jsx';
import SaveSimulationModal from './components/SaveSimulationModal.jsx';
import Logo from './components/Logo.jsx';
import GridExperimentSection from './components/experiments/GridExperimentSection.jsx';
import { FEATURES } from './features.js';
import styles from './App.module.css';
import SiteHeader from './components/common/SiteHeader.jsx';
import PageIntro from './components/common/PageIntro.jsx';

export default function App() {
  const [authChecked, setAuthChecked] = useState(false);
  const [showSaveModal, setShowSaveModal] = useState(false);
  const [isCurrentRunSaved, setIsCurrentRunSaved] = useState(false);
  const [showParams, setShowParams] = useState(false);
  const [showMap, setShowMap] = useState(false);

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
  const runError = useSimStore((s) => s.runError);

  const simActive = isRunning || isPaused;

  // Open to everyone; saving runs needs an account.
  const signedIn = api.isAuthenticated();
  useEffect(() => {
    setAuthChecked(true);
  }, []);

  const handleStart = () => {
    setIsCurrentRunSaved(false);
    if (!initSimulation()) return;
    startSimulation();
  };

  const handleReset = () => {
    setIsCurrentRunSaved(false);
    resetSimulation();
  };

  if (!authChecked) {
    return (
      <div style={{ 
        background: '#0b0f19', 
        color: '#60a5fa', 
        display: 'flex', 
        height: '100vh', 
        justifyContent: 'center', 
        alignItems: 'center', 
        fontFamily: 'monospace',
        fontSize: '1.1rem'
      }}>
        VERIFYING RESEARCHER ACCESS AUTH...
      </div>
    );
  }

  return (
    <>
    <SiteHeader />
    <div className={styles.app}>
      <PageIntro id="grid">
        <strong>Build your own grid.</strong> Set its size, roads and traffic in Configure Parameters, then press Start Simulation to compare Fixed and Greedy side by side.
      </PageIntro>

      <div className={styles.paramsToggleBar} onClick={() => setShowParams(!showParams)}>
        <span>Simulation Parameters & City Import Configuration</span>
        <button className={styles.toggleBtn}>
          {showParams ? 'Hide Settings' : 'Configure Parameters'}
        </button>
      </div>

      {showParams && (
        <div className={styles.paramsContent}>
          <ConfigPanel />
        </div>
      )}

      <ImportedNotes />
      
      {/* Permanent Playback Control Bar placed near the grid */}
      <div className={styles.controlBar}>
        <div className={styles.statusSection}>
          <span className={styles.statusLabel}>SIMULATOR STATUS:</span>
          {isRunning ? (
            <span className={`${styles.statusBadge} ${styles.statusActive}`}>RUNNING</span>
          ) : isPaused ? (
            <span className={`${styles.statusBadge} ${styles.statusPaused}`}>PAUSED</span>
          ) : snapshot?.isComplete ? (
            <span className={`${styles.statusBadge} ${styles.statusActive}`}>COMPLETED</span>
          ) : (
            <span className={`${styles.statusBadge} ${styles.statusIdle}`}>READY TO START</span>
          )}
        </div>
        
        <div className={styles.actionButtons}>
          {!simActive && (
            <button className={`${styles.btn} ${styles.btnStart}`} onClick={handleStart}>
              {snapshot?.isComplete ? 'Restart Simulation' : 'Start Simulation'}
            </button>
          )}
          {isRunning && (
            <button className={`${styles.btn} ${styles.btnPause}`} onClick={pauseSimulation}>
              Stop
            </button>
          )}
          {isPaused && (
            <>
              <button className={`${styles.btn} ${styles.btnStart}`} onClick={resumeSimulation}>
                Resume
              </button>
              <button className={`${styles.btn} ${styles.btnStep}`} onClick={stepBackOnce} disabled={!snapshot || snapshot.time <= 0}>
                Prev Step
              </button>
              <button className={`${styles.btn} ${styles.btnStep}`} onClick={stepOnce}>
                Next Step
              </button>
            </>
          )}
          {(simActive || snapshot?.time > 0) && (
            <button className={`${styles.btn} ${styles.btnReset}`} onClick={handleReset}>
              Reset
            </button>
          )}
          
          {/* Save Run button: Remains visible when paused, running, OR when simulation finishes */}
          {snapshot && snapshot.time > 0 && !signedIn && (
            <Link to="/#auth-section" className={`${styles.btn} ${styles.btnStep}`} style={{ textDecoration: 'none' }}>
              Sign in to save
            </Link>
          )}
          {snapshot && snapshot.time > 0 && signedIn && (
            isCurrentRunSaved ? (
              <button 
                className={`${styles.btn} ${styles.btnSaved}`} 
                disabled 
                title="This simulation run has already been saved to your database"
              >
                Saved
              </button>
            ) : (
              <button 
                className={`${styles.btn} ${styles.btnSave}`} 
                onClick={() => setShowSaveModal(true)}
                title="Save current simulation results & parameters to PostgreSQL"
              >
                Save Run
              </button>
            )
          )}
          {FEATURES.batchRuns && (
            <a href="#extract-details" className={`${styles.btn} ${styles.btnStep}`} style={{ textDecoration: 'none' }} title="Run many simulations and download a report">
              Extract Details
            </a>
          )}
        </div>

        <div className={styles.speedControl}>
          <label>Simulation Speed:</label>
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

      {runError && <div className={styles.runError} role="alert">{runError}</div>}

      <div className={styles.visualGrid}>
        <div>
          <GridVisualization />
        </div>

        {/* Collapsible Real-World Map & Node Correspondence Panel */}
        <div className={styles.mapToggleBar} onClick={() => setShowMap(!showMap)}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
            <span className={styles.mapToggleTitle}>Real-World Map & Node Correspondence</span>
            <span className={styles.mapToggleBadge}>{showMap ? 'Expanded' : 'Collapsed'}</span>
          </div>
          <button className={styles.toggleBtn}>
            {showMap ? 'Hide Map' : 'Explore Real Map'}
          </button>
        </div>

        {showMap && (
          <div className={styles.mapContent}>
            <ErrorBoundary>
              <MapCorrespondencePanel />
            </ErrorBoundary>
          </div>
        )}
      </div>

      <StatsDashboard />

      {FEATURES.batchRuns && <GridExperimentSection />}

      {showSaveModal && (
        <SaveSimulationModal 
          onClose={() => setShowSaveModal(false)} 
          onSaved={() => setIsCurrentRunSaved(true)}
        />
      )}
    </div>
    </>
  );
}
