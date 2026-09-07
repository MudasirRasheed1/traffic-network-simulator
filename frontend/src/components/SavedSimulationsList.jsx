import React, { useState, useEffect } from 'react';
import { useSimStore } from '../store/useSimStore.js';
import { api } from '../utils/api.js';
import styles from './SavedSimulationsList.module.css';

export default function SavedSimulationsList({ onClose }) {
  const [runs, setRuns] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  const fetchRuns = async () => {
    setLoading(true);
    setError('');
    try {
      const data = await api.getSimulations();
      setRuns(data);
    } catch (err) {
      setError(err.message || 'Failed to load saved simulations.');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchRuns();
  }, []);

  const handleLoad = (run) => {
    try {
      const payload = JSON.parse(run.configJson);
      const applyImportedScenario = useSimStore.getState().applyImportedScenario;

      applyImportedScenario({
        configPatch: payload.config,
        roadOverrides: payload.roadOverrides,
        boundaryRoadOverrides: payload.boundaryRoadOverrides,
        departureRateOverrides: payload.departureRateOverrides,
        boundaryInflowOverrides: payload.boundaryInflowOverrides,
        meta: payload.importedScenarioMeta || { name: run.name, type: 'Saved Scenario' }
      });

      onClose();
    } catch (err) {
      alert('Failed to parse config of saved simulation: ' + err.message);
    }
  };

  const handleDelete = async (id, e) => {
    e.stopPropagation();
    if (!window.confirm('Are you sure you want to delete this saved simulation run?')) {
      return;
    }

    try {
      await api.deleteSimulation(id);
      fetchRuns(); // Reload list
    } catch (err) {
      alert('Failed to delete simulation: ' + err.message);
    }
  };

  return (
    <div className={styles.modalOverlay}>
      <div className={styles.modalCard}>
        <div className={styles.modalHeader}>
          <h3>Saved Simulation Runs</h3>
          <button className={styles.closeBtn} onClick={onClose}>&times;</button>
        </div>

        <div className={styles.modalBody}>
          {loading && <div className={styles.statusMsg}>Loading saved runs...</div>}
          {error && <div className={styles.errorMsg}>{error}</div>}

          {!loading && !error && runs.length === 0 && (
            <div className={styles.emptyMsg}>
              No saved simulations found. Run a simulation and click "Save Run" to create one.
            </div>
          )}

          {!loading && !error && runs.length > 0 && (
            <div className={styles.runsList}>
              {runs.map((run) => {
                let results = {};
                try {
                  results = JSON.parse(run.resultsJson);
                } catch(e) {}

                const formattedDate = new Date(run.createdAt).toLocaleString(undefined, {
                  month: 'short',
                  day: 'numeric',
                  year: 'numeric',
                  hour: '2-digit',
                  minute: '2-digit'
                });

                return (
                  <div key={run.id} className={styles.runItem}>
                    <div className={styles.runMainInfo}>
                      <div className={styles.runMeta}>
                        <h4 className={styles.runName}>{run.name}</h4>
                        <span className={styles.runDate}>{formattedDate}</span>
                      </div>
                      {run.description && (
                        <p className={styles.runDesc}>{run.description}</p>
                      )}
                      
                      {/* Comparison Metrics summary */}
                      {results.fixed && results.greedy && (
                        <div className={styles.metricsSummary}>
                          <table className={styles.metricsTable}>
                            <thead>
                              <tr>
                                <th>Policy</th>
                                <th>Throughput</th>
                                <th>Avg Wait Sum</th>
                                <th>Steps</th>
                              </tr>
                            </thead>
                            <tbody>
                              <tr>
                                <td className={styles.fixedCell}>Fixed Cycle</td>
                                <td>{results.fixed.throughput}</td>
                                <td>{results.fixed.sumAvgWaitTimes ? Number(results.fixed.sumAvgWaitTimes).toFixed(1) : '-'}</td>
                                <td rowspan="2" style={{ verticalAlign: 'middle' }}>{results.time}</td>
                              </tr>
                              <tr>
                                <td className={styles.greedyCell}>Greedy Lookahead</td>
                                <td>{results.greedy.throughput}</td>
                                <td>{results.greedy.sumAvgWaitTimes ? Number(results.greedy.sumAvgWaitTimes).toFixed(1) : '-'}</td>
                              </tr>
                            </tbody>
                          </table>
                        </div>
                      )}
                    </div>
                    
                    <div className={styles.runActions}>
                      <button 
                        className={styles.loadBtn}
                        onClick={() => handleLoad(run)}
                      >
                        Load Configuration
                      </button>
                      <button 
                        className={styles.deleteBtn}
                        onClick={(e) => handleDelete(run.id, e)}
                      >
                        Delete
                      </button>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
