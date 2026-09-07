import { useSimStore } from '../store/useSimStore.js';

export default function ImportedNotes() {
  const meta = useSimStore((s) => s.importedScenarioMeta);
  const scenarioMode = useSimStore((s) => s.scenarioMode);

  if (scenarioMode !== 'imported' || !meta?.notes?.length) return null;

  return (
    <div style={{ marginBottom: 16, padding: 10, border: '1px solid #2d2d44', borderRadius: 8, background: '#101426' }}>
      <div style={{ color: '#a5b4fc', fontSize: '0.8rem', marginBottom: 6 }}>Imported Scenario Notes</div>
      <ul style={{ margin: 0, paddingLeft: 18, color: '#9aa7cc', fontSize: '0.78rem' }}>
        {meta.notes.map((n) => (
          <li key={n}>{n}</li>
        ))}
      </ul>
    </div>
  );
}
