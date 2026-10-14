import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { HEDGE_DELAY_MS, OVERPASS_ENDPOINTS, fetchRoadNetwork } from '../osmClient.js';

const GOOD = JSON.stringify({ osm3s: { timestamp_osm_base: '2026-10-13T00:00:00Z' }, elements: [{ type: 'node', id: 1, lat: 0, lon: 0 }] });
const host = (url) => new URL(url).host;
// Each test uses its own area so the in-memory download cache never answers.
let areaSeq = 0;
const freshArea = () => {
  areaSeq += 1;
  return { south: 10 + areaSeq, north: 10.01 + areaSeq, west: 20, east: 20.01 };
};

// behaviours: host -> 'ok' | 'fail' | 'hang' | 'remark'
function mockServers(behaviours) {
  const calls = [];
  const aborted = [];
  vi.stubGlobal('fetch', vi.fn((url, init) => {
    const h = host(url);
    calls.push(h);
    const mode = behaviours[h] || 'fail';
    if (mode === 'ok') return Promise.resolve({ ok: true, status: 200, text: async () => GOOD });
    if (mode === 'remark') return Promise.resolve({ ok: true, status: 200, text: async () => JSON.stringify({ elements: [], remark: 'runtime error: Query timed out in "query" at line 3 after 91 seconds.' }) });
    if (mode === 'fail') return Promise.resolve({ ok: false, status: 504, text: async () => '<html>504</html>' });
    return new Promise((_, reject) => {
      init.signal.addEventListener('abort', () => {
        aborted.push(h);
        reject(Object.assign(new Error('aborted'), { name: 'AbortError' }));
      });
    });
  }));
  return { calls, aborted };
}

const [FIRST, SECOND, THIRD] = OVERPASS_ENDPOINTS.map(host);

describe('road download from the free map servers', () => {
  let stored;
  beforeEach(() => {
    vi.useFakeTimers();
    stored = new Map();
    vi.stubGlobal('localStorage', { getItem: (k) => stored.get(k) ?? null, setItem: (k, v) => stored.set(k, v) });
  });
  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  it('moves on at once when a server fails', async () => {
    const { calls } = mockServers({ [FIRST]: 'fail', [SECOND]: 'ok' });
    const result = await fetchRoadNetwork(freshArea());
    expect(calls).toEqual([FIRST, SECOND]);
    expect(host(result.meta.endpoint)).toBe(SECOND);
    expect(result.meta.elementCount).toBe(1);
  });

  it('does not wait on a server that never answers', async () => {
    const { calls, aborted } = mockServers({ [FIRST]: 'hang', [SECOND]: 'ok' });
    const pending = fetchRoadNetwork(freshArea());
    await vi.advanceTimersByTimeAsync(HEDGE_DELAY_MS - 1);
    expect(calls).toEqual([FIRST]);
    await vi.advanceTimersByTimeAsync(2);
    const result = await pending;
    expect(calls).toEqual([FIRST, SECOND]);
    expect(host(result.meta.endpoint)).toBe(SECOND);
    expect(aborted).toEqual([FIRST]); // the slow request is cancelled
  });

  it('treats a server that gave up on the query as failed', async () => {
    const { calls } = mockServers({ [FIRST]: 'remark', [SECOND]: 'ok' });
    const result = await fetchRoadNetwork(freshArea());
    expect(calls).toEqual([FIRST, SECOND]);
    expect(host(result.meta.endpoint)).toBe(SECOND);
  });

  it('tries the server that worked last time first', async () => {
    mockServers({ [FIRST]: 'fail', [SECOND]: 'fail', [THIRD]: 'ok' });
    await fetchRoadNetwork(freshArea());
    const { calls } = mockServers({ [THIRD]: 'ok' });
    await fetchRoadNetwork(freshArea());
    expect(calls).toEqual([THIRD]);
  });

  it('reports every server when all of them fail', async () => {
    const { calls } = mockServers({});
    const pending = fetchRoadNetwork(freshArea());
    const failure = expect(pending).rejects.toThrow(/servers are busy/);
    await vi.advanceTimersByTimeAsync(10000);
    await failure;
    expect(calls.length).toBe(OVERPASS_ENDPOINTS.length * 2); // two rounds
  });

  it('stops when cancelled', async () => {
    const { aborted } = mockServers({ [FIRST]: 'hang' });
    const controller = new AbortController();
    const pending = fetchRoadNetwork(freshArea(), { signal: controller.signal });
    const failure = expect(pending).rejects.toThrow('Cancelled');
    await vi.advanceTimersByTimeAsync(100);
    controller.abort();
    await failure;
    expect(aborted).toEqual([FIRST]);
  });
});
