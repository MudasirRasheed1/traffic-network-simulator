import React, { useState, useEffect, useMemo } from 'react';
import { useNavigate, Link } from 'react-router-dom';
import { api } from '../utils/api.js';
import { useSimStore } from '../store/useSimStore.js';
import styles from './SavedSimulationsPage.module.css';

function formatMetricValue(val) {
  if (Array.isArray(val)) {
    if (val.length === 0) return 0;
    const last = val[val.length - 1];
    return typeof last === 'number' ? (Number.isInteger(last) ? last : last.toFixed(1)) : (last ?? 0);
  }
  if (typeof val === 'number') {
    return Number.isInteger(val) ? val : val.toFixed(1);
  }
  return val ?? 0;
}

export default function SavedSimulationsPage() {
  const navigate = useNavigate();
  const [simulations, setSimulations] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedGridSize, setSelectedGridSize] = useState('all');
  const [sortBy, setSortBy] = useState('newest');
  const [deletingId, setDeletingId] = useState(null);

  const loadSavedConfiguration = useSimStore((s) => s.loadSavedConfiguration);

  useEffect(() => {
    if (!api.isAuthenticated()) {
      navigate('/');
      return;
    }
    fetchSimulations();
  }, [navigate]);

  const fetchSimulations = async () => {
    setLoading(true);
    setError('');
    try {
      const data = await api.getSimulations();
      setSimulations(Array.isArray(data) ? data : []);
    } catch (err) {
      setError(err.message || 'Failed to fetch saved simulations.');
    } finally {
      setLoading(false);
    }
  };

  const handleLogout = () => {
    api.logout();
    navigate('/');
  };

  const handleDelete = async (id, name) => {
    if (!window.confirm(`Are you sure you want to delete simulation "${name}"? This action cannot be undone.`)) {
      return;
    }
    setDeletingId(id);
    try {
      await api.deleteSimulation(id);
      setSimulations((prev) => prev.filter((s) => s.id !== id));
    } catch (err) {
      alert(err.message || 'Failed to delete simulation.');
    } finally {
      setDeletingId(null);
    }
  };

  const handleReplayInSimulator = (sim) => {
    try {
      const config = JSON.parse(sim.configJson);
      loadSavedConfiguration(config);
      navigate('/simulator');
    } catch (err) {
      alert('Failed to load saved simulation parameters: ' + err.message);
    }
  };

  const handleExportJson = (sim) => {
    try {
      const exportData = {
        id: sim.id,
        name: sim.name,
        description: sim.description,
        createdAt: sim.createdAt,
        configuration: JSON.parse(sim.configJson),
        results: JSON.parse(sim.resultsJson),
      };
      const blob = new Blob([JSON.stringify(exportData, null, 2)], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `${sim.name.replace(/[^a-z0-9]/gi, '_').toLowerCase()}_export.json`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
    } catch (err) {
      alert('Failed to export simulation data: ' + err.message);
    }
  };

  // Filter and sort simulations
  const processedSimulations = useMemo(() => {
    let result = simulations.map((sim) => {
      let parsedConfig = {};
      let parsedResults = {};
      try {
        parsedConfig = JSON.parse(sim.configJson || '{}');
      } catch (e) {
        parsedConfig = {};
      }
      try {
        parsedResults = JSON.parse(sim.resultsJson || '{}');
      } catch (e) {
        parsedResults = {};
      }

      const fixedTp = formatMetricValue(parsedResults.fixed?.throughput);
      const greedyTp = formatMetricValue(parsedResults.greedy?.throughput);
      const tpDiff = Number(greedyTp) - Number(fixedTp);
      const tpPercent = Number(fixedTp) > 0 ? ((tpDiff / Number(fixedTp)) * 100).toFixed(1) : '0';

      const gridSize = parsedConfig.config?.gridSize || parsedConfig.gridSize || 3;
      const simDuration = parsedConfig.config?.simDuration || parsedConfig.simDuration || 100;
      const scenarioMode = parsedConfig.scenarioMode || 'manual';

      return {
        ...sim,
        parsedConfig,
        parsedResults,
        fixedTp,
        greedyTp,
        tpDiff,
        tpPercent,
        gridSize,
        simDuration,
        scenarioMode,
      };
    });

    // Search query filter
    if (searchQuery.trim()) {
      const q = searchQuery.toLowerCase().trim();
      result = result.filter(
        (s) =>
          s.name.toLowerCase().includes(q) ||
          (s.description && s.description.toLowerCase().includes(q))
      );
    }

    // Grid size filter
    if (selectedGridSize !== 'all') {
      const sizeNum = parseInt(selectedGridSize, 10);
      result = result.filter((s) => s.gridSize === sizeNum);
    }

    // Sorting
    result.sort((a, b) => {
      if (sortBy === 'newest') {
        return new Date(b.createdAt || 0) - new Date(a.createdAt || 0);
      }
      if (sortBy === 'oldest') {
        return new Date(a.createdAt || 0) - new Date(b.createdAt || 0);
      }
      if (sortBy === 'highest_greedy') {
        return Number(b.greedyTp) - Number(a.greedyTp);
      }
      if (sortBy === 'highest_fixed') {
        return Number(b.fixedTp) - Number(a.fixedTp);
      }
      return 0;
    });

    return result;
  }, [simulations, searchQuery, selectedGridSize, sortBy]);

  // High level metrics
  const totalSaved = simulations.length;

  return (
    <div className={styles.pageWrapper}>
      {/* Header */}
      <header className={styles.header}>
        <div className={styles.headerLeft}>
          <div className={styles.navRow}>
            <Link to="/simulator" className={styles.backBtn} title="Return to Live Simulator">
              <svg className={styles.backIcon} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                <path d="M19 12H5M12 19l-7-7 7-7"/>
              </svg>
              <span>Back to Simulator</span>
            </Link>
            <span className={styles.breadcrumbSep}>/</span>
            <span className={styles.breadcrumbCurrent}>Saved Archives</span>
          </div>
          <h1>Simulation Run Archives</h1>
          <p>
            Persisted traffic experiments, benchmark comparisons, and scenario configurations stored in PostgreSQL.
          </p>
        </div>

        <div className={styles.toolbar}>
          <div className={styles.researcherBadge}>
            <span>Researcher:</span>
            <strong>{api.username}</strong>
          </div>
          <Link to="/simulator" className={styles.toolbarBtn}>
            Simulator
          </Link>
          <Link to="/saved-simulations" className={`${styles.toolbarBtn} ${styles.toolbarBtnActive}`}>
            Saved Archives
          </Link>
          <Link to="/docs" className={styles.toolbarBtn}>
            Docs
          </Link>
          <Link to="/contact" className={styles.toolbarBtn}>
            Contact
          </Link>
          <button onClick={handleLogout} className={`${styles.toolbarBtn} ${styles.toolbarBtnDanger}`}>
            Log Out
          </button>
        </div>
      </header>

      {/* KPI Overview Summary */}
      <div className={styles.kpiRow}>
        <div className={styles.kpiCard}>
          <span className={styles.kpiLabel}>Total Saved Runs</span>
          <span className={styles.kpiValue}>{totalSaved}</span>
        </div>
        <div className={styles.kpiCard}>
          <span className={styles.kpiLabel}>Quick Action</span>
          <Link to="/simulator" className={styles.kpiActionBtn}>
            + Run New Simulation
          </Link>
        </div>
      </div>

      {/* Filter and Search Bar */}
      <div className={styles.filterBar}>
        <div className={styles.searchWrapper}>
          <input
            type="text"
            placeholder="Search saved runs by name or notes..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className={styles.searchInput}
          />
          {searchQuery && (
            <button className={styles.clearSearchBtn} onClick={() => setSearchQuery('')}>
              &times;
            </button>
          )}
        </div>

        <div className={styles.filterControls}>
          <div className={styles.filterItem}>
            <label>Grid Size:</label>
            <select
              value={selectedGridSize}
              onChange={(e) => setSelectedGridSize(e.target.value)}
              className={styles.selectInput}
            >
              <option value="all">All Sizes</option>
              <option value="2">2 &times; 2 Grid</option>
              <option value="3">3 &times; 3 Grid</option>
              <option value="4">4 &times; 4 Grid</option>
              <option value="5">5 &times; 5 Grid</option>
            </select>
          </div>

          <div className={styles.filterItem}>
            <label>Sort By:</label>
            <select
              value={sortBy}
              onChange={(e) => setSortBy(e.target.value)}
              className={styles.selectInput}
            >
              <option value="newest">Newest First</option>
              <option value="oldest">Oldest First</option>
              <option value="highest_greedy">Highest Greedy Throughput</option>
              <option value="highest_fixed">Highest Fixed Throughput</option>
            </select>
          </div>

          <button onClick={fetchSimulations} className={styles.refreshBtn} title="Refresh Archive List">
            Refresh
          </button>
        </div>
      </div>

      {/* Main Content Area */}
      {loading ? (
        <div className={styles.loadingContainer}>
          <div className={styles.loadingSpinner} />
          <span>Retrieving archived simulation runs...</span>
        </div>
      ) : error ? (
        <div className={styles.errorContainer}>
          <p>{error}</p>
          <button onClick={fetchSimulations} className={styles.retryBtn}>Retry</button>
        </div>
      ) : processedSimulations.length === 0 ? (
        <div className={styles.emptyContainer}>
          <div className={styles.emptyIcon}>📂</div>
          <h3>No Saved Simulations Found</h3>
          <p>
            {searchQuery || selectedGridSize !== 'all'
              ? 'No saved runs matched your search filters. Try adjusting your criteria.'
              : 'You have not saved any simulation runs yet. Run a simulation in the simulator and click "Save Run" to persist results here.'}
          </p>
          <Link to="/simulator" className={styles.startSimBtn}>
            Launch Simulator
          </Link>
        </div>
      ) : (
        <div className={styles.gridCards}>
          {processedSimulations.map((sim) => {
            const formattedDate = sim.createdAt
              ? new Date(sim.createdAt).toLocaleString(undefined, {
                  month: 'short',
                  day: 'numeric',
                  year: 'numeric',
                  hour: '2-digit',
                  minute: '2-digit',
                })
              : 'Unknown Date';

            const fixedEntered = formatMetricValue(sim.parsedResults.fixed?.totalVehiclesEntered);
            const fixedInNetwork = formatMetricValue(sim.parsedResults.fixed?.vehiclesInNetwork);
            const greedyEntered = formatMetricValue(sim.parsedResults.greedy?.totalVehiclesEntered);
            const greedyInNetwork = formatMetricValue(sim.parsedResults.greedy?.vehiclesInNetwork);

            return (
              <div key={sim.id} className={styles.simCard}>
                {/* Card Header */}
                <div className={styles.cardHeader}>
                  <div>
                    <h3 className={styles.simTitle}>{sim.name}</h3>
                    <span className={styles.simTimestamp}>{formattedDate}</span>
                  </div>
                  <div className={styles.badgeRow}>
                    <span className={styles.badgeGrid}>
                      {sim.gridSize}&times;{sim.gridSize} Grid
                    </span>
                    <span className={styles.badgeDuration}>
                      {sim.simDuration} Steps
                    </span>
                    {sim.scenarioMode === 'imported' && (
                      <span className={styles.badgeImported}>Real Map</span>
                    )}
                  </div>
                </div>

                {/* Description */}
                {sim.description && (
                  <p className={styles.simDescription}>{sim.description}</p>
                )}

                {/* Benchmark Metrics Comparison */}
                <div className={styles.metricsContainer}>
                  <div className={styles.metricsColumn}>
                    <div className={styles.policyHeaderFixed}>
                      <span>Fixed Cycle</span>
                    </div>
                    <div className={styles.metricItem}>
                      <span className={styles.metricLabel}>Throughput</span>
                      <span className={styles.metricValFixed}>{sim.fixedTp}</span>
                    </div>
                    <div className={styles.metricItem}>
                      <span className={styles.metricLabel}>Entered</span>
                      <span className={styles.metricVal}>{fixedEntered}</span>
                    </div>
                    <div className={styles.metricItem}>
                      <span className={styles.metricLabel}>In Network</span>
                      <span className={styles.metricVal}>{fixedInNetwork}</span>
                    </div>
                  </div>

                  <div className={styles.metricsColumn}>
                    <div className={styles.policyHeaderGreedy}>
                      <span>Greedy Adaptive</span>
                    </div>
                    <div className={styles.metricItem}>
                      <span className={styles.metricLabel}>Throughput</span>
                      <span className={styles.metricValGreedy}>{sim.greedyTp}</span>
                    </div>
                    <div className={styles.metricItem}>
                      <span className={styles.metricLabel}>Entered</span>
                      <span className={styles.metricVal}>{greedyEntered}</span>
                    </div>
                    <div className={styles.metricItem}>
                      <span className={styles.metricLabel}>In Network</span>
                      <span className={styles.metricVal}>{greedyInNetwork}</span>
                    </div>
                  </div>
                </div>

                {/* Efficiency Delta Callout */}
                <div className={styles.deltaBanner}>
                  {sim.tpDiff > 0 ? (
                    <span className={styles.deltaPositive}>
                      Greedy Served +{sim.tpDiff} more vehicles (+{sim.tpPercent}%)
                    </span>
                  ) : sim.tpDiff < 0 ? (
                    <span className={styles.deltaNegative}>
                      Fixed Served +{Math.abs(sim.tpDiff)} more vehicles
                    </span>
                  ) : (
                    <span className={styles.deltaNeutral}>
                      Equal throughput performance (Tie)
                    </span>
                  )}
                </div>

                {/* Actions Footer */}
                <div className={styles.cardFooter}>
                  <button
                    className={styles.replayBtn}
                    onClick={() => handleReplayInSimulator(sim)}
                    title="Load these parameters directly into the live simulator"
                  >
                    Replay in Simulator
                  </button>
                  <div className={styles.cardFooterSecondary}>
                    <button
                      className={styles.exportBtn}
                      onClick={() => handleExportJson(sim)}
                      title="Download simulation JSON export"
                    >
                      Export JSON
                    </button>
                    <button
                      className={styles.deleteBtn}
                      onClick={() => handleDelete(sim.id, sim.name)}
                      disabled={deletingId === sim.id}
                      title="Permanently remove run from database"
                    >
                      {deletingId === sim.id ? 'Deleting...' : 'Delete'}
                    </button>
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
