import React from 'react';
import styles from './Logo.module.css';

export default function Logo({ size = 'medium', showText = true, subtitle = null, className = '' }) {
  const iconSizes = {
    small: { width: 32, height: 32 },
    medium: { width: 40, height: 40 },
    large: { width: 52, height: 52 }
  };

  const currentSize = iconSizes[size] || iconSizes.medium;

  return (
    <div className={`${styles.logoContainer} ${styles[size]} ${className}`}>
      <div className={styles.iconWrapper} style={{ width: currentSize.width, height: currentSize.height }}>
        <svg
          viewBox="0 0 100 100"
          fill="none"
          xmlns="http://www.w3.org/2000/svg"
          className={styles.svgIcon}
        >
          <defs>
            <linearGradient id="logoBgGrad" x1="0%" y1="0%" x2="100%" y2="100%">
              <stop offset="0%" stopColor="#0f172a" />
              <stop offset="100%" stopColor="#020617" />
            </linearGradient>

            <linearGradient id="roadHGrad" x1="0%" y1="0%" x2="100%" y2="0%">
              <stop offset="0%" stopColor="#38bdf8" stopOpacity="0.4" />
              <stop offset="50%" stopColor="#38bdf8" />
              <stop offset="100%" stopColor="#2dd4bf" stopOpacity="0.8" />
            </linearGradient>

            <linearGradient id="roadVGrad" x1="0%" y1="0%" x2="0%" y2="100%">
              <stop offset="0%" stopColor="#a78bfa" stopOpacity="0.4" />
              <stop offset="50%" stopColor="#818cf8" />
              <stop offset="100%" stopColor="#38bdf8" stopOpacity="0.8" />
            </linearGradient>

            <filter id="cyanGlow" x="-20%" y="-20%" width="140%" height="140%">
              <feGaussianBlur stdDeviation="3" result="blur" />
              <feComposite in="SourceGraphic" in2="blur" operator="over" />
            </filter>
            
            <filter id="signalGlow" x="-50%" y="-50%" width="200%" height="200%">
              <feGaussianBlur stdDeviation="2" result="blur" />
              <feComposite in="SourceGraphic" in2="blur" operator="over" />
            </filter>
          </defs>

          {/* Hexagonal / Rounded Base Shield */}
          <rect
            x="4"
            y="4"
            width="92"
            height="92"
            rx="24"
            fill="url(#logoBgGrad)"
            stroke="#334155"
            strokeWidth="2"
          />

          {/* Grid Guideline Background subtle dots */}
          <circle cx="28" cy="28" r="1.5" fill="#334155" />
          <circle cx="72" cy="28" r="1.5" fill="#334155" />
          <circle cx="28" cy="72" r="1.5" fill="#334155" />
          <circle cx="72" cy="72" r="1.5" fill="#334155" />

          {/* Intersecting Dual-Carriageway Highway Corridors */}
          {/* Horizontal Arterial Road */}
          <path
            d="M 12 50 L 88 50"
            stroke="#1e293b"
            strokeWidth="14"
            strokeLinecap="round"
          />
          {/* Vertical Arterial Road */}
          <path
            d="M 50 12 L 50 88"
            stroke="#1e293b"
            strokeWidth="14"
            strokeLinecap="round"
          />

          {/* Highway Lanes Glow Path */}
          <path
            d="M 14 50 L 86 50"
            stroke="url(#roadHGrad)"
            strokeWidth="3.5"
            strokeLinecap="round"
            filter="url(#cyanGlow)"
          />
          <path
            d="M 50 14 L 50 86"
            stroke="url(#roadVGrad)"
            strokeWidth="3.5"
            strokeLinecap="round"
          />

          {/* Dashed Lane Divider Marks */}
          <line x1="20" y1="46" x2="34" y2="46" stroke="#475569" strokeWidth="1" strokeDasharray="3 3" />
          <line x1="66" y1="46" x2="80" y2="46" stroke="#475569" strokeWidth="1" strokeDasharray="3 3" />
          <line x1="20" y1="54" x2="34" y2="54" stroke="#475569" strokeWidth="1" strokeDasharray="3 3" />
          <line x1="66" y1="54" x2="80" y2="54" stroke="#475569" strokeWidth="1" strokeDasharray="3 3" />

          {/* Dynamic Vehicle Flow Packets (Westbound, Eastbound, Northbound, Southbound) */}
          {/* Eastbound vehicle */}
          <rect x="25" y="47.5" width="8" height="5" rx="1.5" fill="#38bdf8" />
          {/* Westbound vehicle */}
          <rect x="67" y="47.5" width="8" height="5" rx="1.5" fill="#2dd4bf" />
          {/* Southbound vehicle */}
          <rect x="47.5" y="25" width="5" height="8" rx="1.5" fill="#a78bfa" />
          {/* Northbound vehicle */}
          <rect x="47.5" y="67" width="5" height="8" rx="1.5" fill="#38bdf8" />

          {/* Central Intersection Optimization Hub Ring */}
          <circle
            cx="50"
            cy="50"
            r="16"
            fill="#090d16"
            stroke="#38bdf8"
            strokeWidth="2"
          />

          {/* 4 Quadrant Traffic Phase Signal Indicators */}
          {/* North Signal: Green */}
          <circle cx="50" cy="39" r="3.2" fill="#22c55e" filter="url(#signalGlow)" />
          {/* South Signal: Green */}
          <circle cx="50" cy="61" r="3.2" fill="#22c55e" filter="url(#signalGlow)" />
          {/* West Signal: Red */}
          <circle cx="39" cy="50" r="3.2" fill="#ef4444" />
          {/* East Signal: Red */}
          <circle cx="61" cy="50" r="3.2" fill="#ef4444" />

          {/* Central Core Smart Node */}
          <circle cx="50" cy="50" r="3.5" fill="#f8fafc" />
        </svg>
      </div>

      {showText && (
        <div className={styles.brandTextWrapper}>
          <div className={styles.brandTitle}>
            Traffic <span className={styles.highlight}>Simulator</span>
          </div>
          {subtitle && <div className={styles.brandSubtitle}>{subtitle}</div>}
        </div>
      )}
    </div>
  );
}
