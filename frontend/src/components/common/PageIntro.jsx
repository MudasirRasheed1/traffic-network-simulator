// =====================================================
// PAGE INTRO
// One short line at the top of a page saying what it is for. It can be
// closed; the choice is remembered in this browser.
// =====================================================
import { useState } from 'react';
import styles from './PageIntro.module.css';

export default function PageIntro({ id, children }) {
  const key = `urbangrid-intro-${id}`;
  const [open, setOpen] = useState(() => {
    try { return localStorage.getItem(key) !== 'closed'; } catch { return true; }
  });
  if (!open) return null;
  const close = () => {
    setOpen(false);
    try { localStorage.setItem(key, 'closed'); } catch { /* per browser only */ }
  };
  return (
    <div className={styles.intro}>
      <div className={styles.text}>{children}</div>
      <button type="button" className={styles.close} onClick={close} aria-label="Close">×</button>
    </div>
  );
}
