import React, { useState } from 'react';
import { useSimStore } from '../store/useSimStore.js';
import { api } from '../utils/api.js';
import styles from './SaveSimulationModal.module.css';

export default function SaveSimulationModal({ onClose, onSaved }) {
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');
  const [saving, setSaving] = useState(false);

  const handleSave = async (e) => {
    e.preventDefault();
    if (!name.trim()) {
      setError('Please provide a name for this simulation run.');
      return;
    }

    setError('');
    setSuccess('');
    setSaving(true);

    try {
      const state = useSimStore.getState();
      
      if (!state.snapshot) {
        throw new Error("No simulation results available to save. Please run the simulation first.");
      }

      // Gather configuration parameters to reconstruct simulation
      const configToSave = {
        config: state.config,
        scenarioMode: state.scenarioMode,
        importedScenarioMeta: state.importedScenarioMeta,
        boundaryInflowOverrides: state.boundaryInflowOverrides,
        departureRateOverrides: state.departureRateOverrides,
        roadOverrides: state.roadOverrides,
        boundaryRoadOverrides: state.boundaryRoadOverrides,
      };

      const extractScalar = (val) => {
        if (Array.isArray(val)) {
          return val.length > 0 ? val[val.length - 1] : 0;
        }
        return typeof val === 'number' ? val : (val ?? 0);
      };

      // Gather current simulation results summary
      const resultsToSave = {
        time: state.snapshot.time,
        fixed: {
          throughput: extractScalar(state.snapshot.fixed?.throughput),
          totalVehiclesEntered: extractScalar(state.snapshot.fixed?.totalVehiclesEntered),
          vehiclesInNetwork: extractScalar(state.snapshot.fixed?.vehiclesInNetwork),
          sumAvgWaitTimes: extractScalar(state.snapshot.fixed?.sumAvgWaitTimes),
          sumTotalWaitTimes: extractScalar(state.snapshot.fixed?.sumTotalWaitTimes),
        },
        greedy: {
          throughput: extractScalar(state.snapshot.greedy?.throughput),
          totalVehiclesEntered: extractScalar(state.snapshot.greedy?.totalVehiclesEntered),
          vehiclesInNetwork: extractScalar(state.snapshot.greedy?.vehiclesInNetwork),
          sumAvgWaitTimes: extractScalar(state.snapshot.greedy?.sumAvgWaitTimes),
          sumTotalWaitTimes: extractScalar(state.snapshot.greedy?.sumTotalWaitTimes),
        }
      };

      await api.saveSimulation(name.trim(), description.trim(), configToSave, resultsToSave);
      setSuccess('Simulation run saved successfully!');
      if (onSaved) {
        onSaved();
      }
      setTimeout(() => {
        onClose();
      }, 1000);
    } catch (err) {
      setError(err.message || 'Failed to save simulation. Please try again.');
      setSaving(false);
    }
  };

  return (
    <div className={styles.modalOverlay}>
      <div className={styles.modalCard}>
        <div className={styles.modalHeader}>
          <h3>Save Simulation Run</h3>
          <button className={styles.closeBtn} onClick={onClose}>&times;</button>
        </div>
        <form onSubmit={handleSave} className={styles.modalForm}>
          <p className={styles.helperText}>
            Persist your active configuration parameters and current performance metrics into the PostgreSQL database.
          </p>

          {error && <div className={styles.errorMsg}>{error}</div>}
          {success && <div className={styles.successMsg}>{success}</div>}

          <div className={styles.formGroup}>
            <label>Simulation Run Name *</label>
            <input 
              type="text" 
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="e.g. 3x3 Grid Peak Traffic Run" 
              required
              disabled={saving || !!success}
            />
          </div>

          <div className={styles.formGroup}>
            <label>Description / Research Notes</label>
            <textarea 
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="e.g. Testing Greedy decision interval with high lookahead (H=8)." 
              rows={3}
              disabled={saving || !!success}
            />
          </div>

          <div className={styles.actionButtons}>
            <button 
              type="button" 
              className={styles.cancelBtn} 
              onClick={onClose} 
              disabled={saving || !!success}
            >
              Cancel
            </button>
            <button 
              type="submit" 
              className={styles.saveBtn} 
              disabled={saving || !!success}
            >
              {saving ? 'Saving...' : success ? 'Saved!' : 'Save Run'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
