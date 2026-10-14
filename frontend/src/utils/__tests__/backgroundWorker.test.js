import { describe, expect, it } from 'vitest';
import { WORKER_CANNOT_START, WORKER_STOPPED, createBackgroundWorker } from '../backgroundWorker.js';

// A stand-in for a browser Worker that the test drives by hand.
function fakeWorker() {
  const w = {
    posted: [],
    terminated: false,
    postMessage(msg) { w.posted.push(msg); },
    terminate() { w.terminated = true; },
    reply(data) { w.onmessage?.({ data }); },
    crash() { w.onerror?.({ preventDefault() {} }); },
  };
  return w;
}

describe('background worker', () => {
  it('reuses one worker for every job and matches answers to jobs', async () => {
    const made = [];
    const bg = createBackgroundWorker(() => { const w = fakeWorker(); made.push(w); return w; });
    bg.warm();
    made[0].reply({ type: 'ready' });
    const a = bg.run({ n: 1 });
    const b = bg.run({ n: 2 });
    made[0].reply({ id: b.id, ok: true, value: 'second' });
    made[0].reply({ id: a.id, ok: true, value: 'first' });
    expect((await a.promise).value).toBe('first');
    expect((await b.promise).value).toBe('second');
    expect(made).toHaveLength(1);
  });

  it('passes progress on and reports a failed job', async () => {
    const w = fakeWorker();
    const bg = createBackgroundWorker(() => w);
    const seen = [];
    const job = bg.run({}, { onProgress: (p) => seen.push(p.done) });
    w.reply({ id: job.id, type: 'progress', done: 1 });
    w.reply({ id: job.id, type: 'error', error: 'bad input' });
    await expect(job.promise).rejects.toThrow('bad input');
    expect(seen).toEqual([1]);
  });

  it('says the builder could not start when its code never loaded', async () => {
    const w = fakeWorker();
    const bg = createBackgroundWorker(() => w);
    const job = bg.run({});
    w.crash();
    await expect(job.promise).rejects.toThrow(WORKER_CANNOT_START);
    expect(w.terminated).toBe(true);
  });

  it('says the builder stopped while working when it had loaded, and starts a new one next time', async () => {
    const made = [];
    const bg = createBackgroundWorker(() => { const w = fakeWorker(); made.push(w); return w; });
    const job = bg.run({});
    made[0].reply({ type: 'ready' });
    made[0].crash();
    await expect(job.promise).rejects.toThrow(WORKER_STOPPED);
    bg.run({});
    expect(made).toHaveLength(2);
  });

  it('can stop waiting for a job', async () => {
    const w = fakeWorker();
    const bg = createBackgroundWorker(() => w);
    const job = bg.run({});
    bg.forget(job.id);
    w.reply({ id: job.id, ok: true });
    const settled = await Promise.race([job.promise.then(() => 'settled'), new Promise((r) => setTimeout(() => r('waiting'), 20))]);
    expect(settled).toBe('waiting');
  });
});
