import { buildImportedScenario } from './osmParser.js';

self.onmessage = (event) => {
  const { place, overpassData } = event.data || {};
  try {
    const imported = buildImportedScenario({ place, overpassData });
    self.postMessage({ ok: true, imported });
  } catch (error) {
    self.postMessage({
      ok: false,
      error: error?.message || 'Failed to build imported scenario',
    });
  }
};
