// =====================================================
// COLLAPSIBLE SIDE PANELS
// A sidebar that can be folded away to a thin rail, and panels inside
// it that open and close on their header. What is open is remembered
// in this browser per page.
// =====================================================
import { useState } from 'react';
import styles from './Collapsible.module.css';

function readState(key, fallback) {
  try {
    const raw = localStorage.getItem(key);
    return raw ? { ...fallback, ...JSON.parse(raw) } : fallback;
  } catch {
    return fallback;
  }
}

// Open/closed state for a set of named panels plus the sidebar itself.
export function usePanels(storageKey, defaults) {
  const [state, setState] = useState(() => readState(storageKey, { sidebar: true, ...defaults }));
  const save = (next) => {
    setState(next);
    try { localStorage.setItem(storageKey, JSON.stringify(next)); } catch { /* per-browser only */ }
  };
  return {
    isOpen: (id) => state[id] !== false,
    toggle: (id) => save({ ...state, [id]: state[id] === false }),
    setOpen: (id, open) => save({ ...state, [id]: open }),
  };
}

export function CollapsiblePanel({ id, title, panels, className = '', extra = null, children }) {
  const open = panels.isOpen(id);
  return (
    <section className={`${className} ${styles.panel} ${open ? '' : styles.closed}`}>
      <button type="button" className={styles.head} onClick={() => panels.toggle(id)} aria-expanded={open}>
        <span className={styles.title}>{title}</span>
        {extra}
        <span className={styles.chevron} aria-hidden="true">{open ? '−' : '+'}</span>
      </button>
      {open && <div className={styles.body}>{children}</div>}
    </section>
  );
}

// The sidebar: a column of panels, or a thin rail with a button to bring it back.
export function CollapsibleSidebar({ panels, className = '', label = 'Panels', children }) {
  const open = panels.isOpen('sidebar');
  if (!open) {
    return (
      <aside className={styles.rail}>
        <button type="button" className={styles.railBtn} onClick={() => panels.setOpen('sidebar', true)} title={`Show ${label.toLowerCase()}`} aria-label={`Show ${label.toLowerCase()}`}>
          <span aria-hidden="true">»</span>
          <span className={styles.railLabel}>{label}</span>
        </button>
      </aside>
    );
  }
  return (
    <aside className={`${className} ${styles.sidebar}`}>
      <button type="button" className={styles.hideBtn} onClick={() => panels.setOpen('sidebar', false)} title={`Hide ${label.toLowerCase()}`}>
        « Hide {label.toLowerCase()}
      </button>
      {children}
    </aside>
  );
}
