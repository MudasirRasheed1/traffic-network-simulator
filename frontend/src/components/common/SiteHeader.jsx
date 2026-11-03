// =====================================================
// SITE HEADER
// The same navigation on every page: one set of links when signed out,
// one when signed in. The current page is highlighted. Signed out, the
// simulators are reached through Start here, not the header.
// =====================================================
import { Link, useLocation, useNavigate } from 'react-router-dom';
import { api } from '../../utils/api.js';
import Logo from '../Logo.jsx';
import styles from './SiteHeader.module.css';

const LINKS = [
  { to: '/demo', label: 'Start here' },
  { to: '/simulator', label: 'Grid Simulator', account: true },
  { to: '/city-sim', label: 'City Simulator', account: true },
  { to: '/network', label: 'Network Explorer', account: true },
  { to: '/docs', label: 'Docs' },
];

// The highlighted link already names the page, so the logo has no subtitle.
export default function SiteHeader() {
  const { pathname } = useLocation();
  const navigate = useNavigate();
  const signedIn = api.isAuthenticated();
  const signIn = () => {
    if (pathname === '/') document.getElementById('auth-section')?.scrollIntoView({ behavior: 'smooth' });
    else navigate('/#auth-section');
  };
  const logOut = () => {
    api.logout();
    navigate('/');
  };
  const active = (to) => (pathname === to ? styles.active : '');

  return (
    <header className={styles.header}>
      {/* Home; signed in, the home is the Grid Simulator. */}
      <Link to={signedIn ? '/simulator' : '/'} className={styles.logo} title={signedIn ? 'Grid Simulator' : 'Home'}>
        <Logo size="small" />
      </Link>
      <nav className={styles.nav}>
        {LINKS.filter((l) => signedIn || !l.account).map((l) => (
          <Link key={l.to} to={l.to} className={active(l.to)}>{l.label}</Link>
        ))}
      </nav>
      <div className={styles.account}>
        {signedIn ? (
          <>
            <Link to="/saved-simulations" className={active('/saved-simulations')}>Saved</Link>
            <button type="button" className={styles.ghost} onClick={logOut}>Log out</button>
          </>
        ) : (
          <button type="button" className={styles.primary} onClick={signIn}>Sign in</button>
        )}
      </div>
    </header>
  );
}
