// =====================================================
// BACKGROUND WORKER, STARTED ONCE AND REUSED
//
// Pages start their worker as soon as they open (warm()) and keep it.
// Once its code has loaded it keeps working even if the local dev
// server is stopped later, which used to show up as "worker crashed".
// When something does go wrong the error says whether the worker could
// not start at all or broke while working.
//
// Protocol: the worker posts { type: 'ready' } once loaded. Each job is
// posted with an id; the worker answers with the same id:
//   { id, type: 'progress', ... }   any number of times
//   { id, ok: false, error } or { id, type: 'error', error }   failure
//   { id, ... }                      anything else ends the job
// =====================================================

export const WORKER_CANNOT_START = 'Could not start the background builder. The local dev server may have stopped: start it again and reload this page.';
export const WORKER_STOPPED = 'The background builder stopped while working, most likely out of memory. Try a smaller area or main roads only.';

export function createBackgroundWorker(makeWorker) {
  let worker = null;
  let ready = false;
  let nextId = 0;
  const jobs = new Map(); // id -> { resolve, reject, onProgress }

  const fail = (message) => {
    const error = new Error(message);
    for (const job of jobs.values()) job.reject(error);
    jobs.clear();
    worker?.terminate();
    worker = null;
    ready = false;
  };

  const start = () => {
    if (worker) return worker;
    ready = false;
    worker = makeWorker();
    worker.onmessage = (event) => {
      const data = event.data || {};
      if (data.type === 'ready') {
        ready = true;
        return;
      }
      const job = jobs.get(data.id);
      if (!job) return; // a job nobody waits for any more
      if (data.type === 'progress') {
        job.onProgress?.(data);
        return;
      }
      jobs.delete(data.id);
      if (data.ok === false || data.type === 'error') job.reject(new Error(data.error || 'Background task failed'));
      else job.resolve(data);
    };
    worker.onerror = (event) => {
      event.preventDefault?.();
      fail(ready ? WORKER_STOPPED : WORKER_CANNOT_START);
    };
    return worker;
  };

  return {
    // Load the worker now, while the dev server is surely up.
    warm: () => { start(); },
    // Returns { promise, id }. Pass the id to forget() to stop waiting for it.
    run(payload, { onProgress } = {}) {
      const w = start();
      nextId += 1;
      const id = nextId;
      const promise = new Promise((resolve, reject) => {
        jobs.set(id, { resolve, reject, onProgress });
        w.postMessage({ ...payload, id });
      });
      return { promise, id };
    },
    // Stop waiting for a job (it finishes quietly in the background).
    forget(id) {
      jobs.delete(id);
    },
  };
}
