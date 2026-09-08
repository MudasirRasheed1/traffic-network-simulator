import React, { useState, useEffect, useRef } from 'react';
import { useNavigate, Link } from 'react-router-dom';
import { api } from '../utils/api.js';
import styles from './LandingPage.module.css';
import Logo from './Logo';

export default function LandingPage() {
  const navigate = useNavigate();
  const canvasRef = useRef(null);
  const [isLogin, setIsLogin] = useState(true);
  const [formData, setFormData] = useState({
    username: '',
    email: '',
    password: '',
    confirmPassword: '',
  });
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    // If user is already authenticated, redirect to simulator
    if (api.isAuthenticated()) {
      navigate('/simulator');
    }
  }, [navigate]);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    let animationFrameId;

    let width = (canvas.width = window.innerWidth);
    let height = (canvas.height = window.innerHeight);

    const handleResize = () => {
      width = canvas.width = window.innerWidth;
      height = canvas.height = window.innerHeight;
    };
    window.addEventListener('resize', handleResize);

    // Stars / Particles configuration
    const numStars = 100;
    const stars = [];
    const mouse = { x: null, y: null, radius: 150 };

    for (let i = 0; i < numStars; i++) {
      stars.push({
        x: Math.random() * width,
        y: Math.random() * height,
        r: Math.random() * 1.5 + 0.5,
        vx: (Math.random() - 0.5) * 0.4,
        vy: (Math.random() - 0.5) * 0.4,
        alpha: Math.random() * 0.5 + 0.3,
        twinkleSpeed: Math.random() * 0.02 + 0.005,
        twinkleDir: Math.random() > 0.5 ? 1 : -1
      });
    }

    const handleMouseMove = (e) => {
      mouse.x = e.clientX;
      mouse.y = e.clientY;
    };

    const handleMouseLeave = () => {
      mouse.x = null;
      mouse.y = null;
    };

    window.addEventListener('mousemove', handleMouseMove);
    document.addEventListener('mouseleave', handleMouseLeave);

    const animate = () => {
      ctx.clearRect(0, 0, width, height);

      // Draw starry constellations
      for (let i = 0; i < numStars; i++) {
        const star = stars[i];

        // Move stars
        star.x += star.vx;
        star.y += star.vy;

        // Wrap around screen boundaries
        if (star.x < 0) star.x = width;
        if (star.x > width) star.x = 0;
        if (star.y < 0) star.y = height;
        if (star.y > height) star.y = 0;

        // Twinkle effect (twinkle alpha slightly)
        star.alpha += star.twinkleSpeed * star.twinkleDir;
        if (star.alpha > 0.95 || star.alpha < 0.25) {
          star.twinkleDir *= -1;
        }

        // Draw star
        ctx.beginPath();
        ctx.arc(star.x, star.y, star.r, 0, Math.PI * 2);
        ctx.fillStyle = `rgba(186, 230, 253, ${star.alpha})`;
        ctx.shadowBlur = star.r * 4;
        ctx.shadowColor = 'rgba(56, 189, 248, 0.4)';
        ctx.fill();
        ctx.shadowBlur = 0; // Reset shadow

        // Check distance to other stars to draw subtle constellation lines
        for (let j = i + 1; j < numStars; j++) {
          const other = stars[j];
          const dist = Math.hypot(star.x - other.x, star.y - other.y);
          if (dist < 100) {
            const lineAlpha = (1 - dist / 100) * 0.15;
            ctx.beginPath();
            ctx.moveTo(star.x, star.y);
            ctx.lineTo(other.x, other.y);
            ctx.strokeStyle = `rgba(56, 189, 248, ${lineAlpha})`;
            ctx.lineWidth = 0.5;
            ctx.stroke();
          }
        }

        // Check distance to mouse to interact
        if (mouse.x !== null && mouse.y !== null) {
          const mDist = Math.hypot(star.x - mouse.x, star.y - mouse.y);
          if (mDist < mouse.radius) {
            const lineAlpha = (1 - mDist / mouse.radius) * 0.4;
            ctx.beginPath();
            ctx.moveTo(star.x, star.y);
            ctx.lineTo(mouse.x, mouse.y);
            ctx.strokeStyle = `rgba(52, 211, 153, ${lineAlpha})`; // green/emerald link to mouse
            ctx.lineWidth = 0.7;
            ctx.stroke();
          }
        }
      }

      animationFrameId = requestAnimationFrame(animate);
    };

    animate();

    return () => {
      window.removeEventListener('resize', handleResize);
      window.removeEventListener('mousemove', handleMouseMove);
      document.removeEventListener('mouseleave', handleMouseLeave);
      cancelAnimationFrame(animationFrameId);
    };
  }, []);

  const handleInputChange = (e) => {
    const { name, value } = e.target;
    setFormData((prev) => ({ ...prev, [name]: value }));
  };

  const validateEmail = (email) => {
    return /\S+@\S+\.\S+/.test(email);
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError('');
    setSuccess('');
    setLoading(true);

    const { username, email, password, confirmPassword } = formData;

    if (isLogin) {
      // Login validation
      if (!username || !password) {
        setError('Please fill in all fields.');
        setLoading(false);
        return;
      }

      try {
        await api.login(username, password);
        setSuccess('Login successful! Redirecting...');
        setTimeout(() => {
          navigate('/simulator');
        }, 1000);
      } catch (err) {
        setError(err.message || 'Login failed. Please try again.');
        setLoading(false);
      }
    } else {
      // Signup validation
      if (!username || !email || !password || !confirmPassword) {
        setError('Please fill in all fields.');
        setLoading(false);
        return;
      }

      if (!validateEmail(email)) {
        setError('Please enter a valid email address.');
        setLoading(false);
        return;
      }

      if (password.length < 6) {
        setError('Password must be at least 6 characters long.');
        setLoading(false);
        return;
      }

      if (password !== confirmPassword) {
        setError('Passwords do not match.');
        setLoading(false);
        return;
      }

      try {
        await api.signup(username, email, password);
        setSuccess('Account created successfully! You can now log in.');
        setIsLogin(true);
        setFormData({
          username: '',
          email: '',
          password: '',
          confirmPassword: '',
        });
        setLoading(false);
      } catch (err) {
        setError(err.message || 'Registration failed. Please try again.');
        setLoading(false);
      }
    }
  };

  return (
    <div className={styles.landingContainer}>
      {/* Interactive starry canvas background */}
      <canvas ref={canvasRef} className={styles.starryCanvas}></canvas>

      {/* Grid Overlay background */}
      <div className={styles.gridOverlay}></div>

      {/* Header */}
      <header className={styles.header}>
        <div className={styles.logoArea}>
          <Logo size="medium" />
        </div>
        <div className={styles.headerNav}>
          <Link to="/demo" className={styles.demoNavBtn}>
            Interactive Demos
          </Link>
          <Link to="/docs" className={styles.navLink}>Documentation</Link>
          <Link to="/contact" className={styles.navLink}>Contact Us</Link>
          <button 
            className={styles.primaryNavBtn}
            onClick={() => {
              const el = document.getElementById('auth-section');
              if (el) el.scrollIntoView({ behavior: 'smooth' });
            }}
          >
            Access Simulator
          </button>
        </div>
      </header>

      {/* Hero Content Section */}
      <main className={styles.heroSection}>
        <div className={styles.infoArea}>
          <div className={styles.badgeRow}>
            <div className={styles.badge}>ADAPTIVE TRAFFIC INTELLIGENCE</div>
            <Link to="/demo" className={styles.liveDemoHeroBadge}>
              <span className={styles.liveDot}></span>
              <span>4 Live Benchmark Scenarios</span>
            </Link>
          </div>
          <h1 className={styles.mainTitle}>
            Adaptive Traffic Signal <br />
            <span className={styles.gradientText}>Modeling & Optimization</span>
          </h1>
          <p className={styles.description}>
            Deploy and evaluate real-time <strong>Adaptive Signal Controllers</strong> against baseline <strong>Fixed-Cycle</strong> schedules. Configure custom intersection networks, test dynamic traffic inflows, and analyze live throughput performance.
          </p>

          <div className={styles.heroCtaRow}>
            <Link to="/demo" className={styles.liveDemoHeroBtn}>
              <span>Explore Interactive Demos (Zero Login)</span>
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" className={styles.ctaArrowIcon}>
                <line x1="5" y1="12" x2="19" y2="12"></line>
                <polyline points="12 5 19 12 12 19"></polyline>
              </svg>
            </Link>
          </div>

          <div className={styles.featuresGrid}>
            <div className={styles.featureCard}>
              <div className={`${styles.cardIcon} ${styles.blueIcon}`}></div>
              <h3>Adaptive Lookahead Control</h3>
              <p>Uses rolling horizon optimization to minimize queue lengths and vehicle wait-times dynamically.</p>
            </div>
            <div className={styles.featureCard}>
              <div className={`${styles.cardIcon} ${styles.greenIcon}`}></div>
              <h3>OpenStreetMap (OSM) Support</h3>
              <p>Extract real-world road geometries, node layouts, and intersection arrays directly via standard OSM APIs.</p>
            </div>
            <div className={styles.featureCard}>
              <div className={`${styles.cardIcon} ${styles.purpleIcon}`}></div>
              <h3>Parametric Arrival Profiles</h3>
              <p>Define time-variant flow rates, boundary turning probabilities, and boundary inflows per direction.</p>
            </div>
            <div className={styles.featureCard}>
              <div className={`${styles.cardIcon} ${styles.orangeIcon}`}></div>
              <h3>Scenario History Archival</h3>
              <p>Persist, compare, and instantly restore custom simulation runs and configurations with PostgreSQL database storage.</p>
            </div>
          </div>
        </div>

        {/* Auth Section */}
        <div id="auth-section" className={styles.authArea}>
          <div className={styles.authCard}>
            <div className={styles.authTabs}>
              <button 
                className={`${styles.tabBtn} ${isLogin ? styles.activeTab : ''}`}
                onClick={() => { setIsLogin(true); setError(''); setSuccess(''); }}
              >
                Log In
              </button>
              <button 
                className={`${styles.tabBtn} ${!isLogin ? styles.activeTab : ''}`}
                onClick={() => { setIsLogin(false); setError(''); setSuccess(''); }}
              >
                Sign Up
              </button>
            </div>

            <form onSubmit={handleSubmit} className={styles.authForm}>
              <h2 className={styles.formTitle}>
                {isLogin ? 'Access Scientific Simulator' : 'Register Simulator Account'}
              </h2>
              <p className={styles.formSubtitle}>
                {isLogin 
                  ? 'Sign in to run scenarios and persist simulation run results.' 
                  : 'Create a researcher profile to save runs and compare results.'}
              </p>

              {error && <div className={styles.errorBanner}>{error}</div>}
              {success && <div className={styles.successBanner}>{success}</div>}

              <div className={styles.inputGroup}>
                <label>Username {isLogin && 'or Email'}</label>
                <input 
                  type="text" 
                  name="username" 
                  value={formData.username}
                  onChange={handleInputChange}
                  placeholder={isLogin ? "Enter username or email" : "Choose username"} 
                  autoComplete="off"
                  required
                />
              </div>

              {!isLogin && (
                <div className={styles.inputGroup}>
                  <label>Email Address</label>
                  <input 
                    type="email" 
                    name="email" 
                    value={formData.email}
                    onChange={handleInputChange}
                    placeholder="e.g. researcher@university.edu" 
                    autoComplete="off"
                    required
                  />
                </div>
              )}

              <div className={styles.inputGroup}>
                <label>Password</label>
                <input 
                  type="password" 
                  name="password" 
                  value={formData.password}
                  onChange={handleInputChange}
                  placeholder="••••••••" 
                  autoComplete={isLogin ? "current-password" : "new-password"}
                  required
                />
              </div>

              {!isLogin && (
                <div className={styles.inputGroup}>
                  <label>Confirm Password</label>
                  <input 
                    type="password" 
                    name="confirmPassword" 
                    value={formData.confirmPassword}
                    onChange={handleInputChange}
                    placeholder="••••••••" 
                    required
                  />
                </div>
              )}

              <button 
                type="submit" 
                className={styles.submitBtn} 
                disabled={loading}
              >
                {loading ? 'Processing...' : (isLogin ? 'Sign In' : 'Create Account')}
              </button>
            </form>
          </div>
        </div>
      </main>

      {/* Footer */}
      <footer className={styles.footer}>
        <div style={{ display: 'flex', justifyContent: 'center', alignItems: 'center', gap: '20px', flexWrap: 'wrap' }}>
          <Link to="/demo" style={{ color: '#38bdf8', fontSize: '0.82rem', textDecoration: 'none', fontWeight: 600 }}>Interactive Demos</Link>
          <span style={{ color: '#334155' }}>•</span>
          <Link to="/docs" style={{ color: '#38bdf8', fontSize: '0.82rem', textDecoration: 'none', fontWeight: 600 }}>Documentation</Link>
          <span style={{ color: '#334155' }}>•</span>
          <Link to="/contact" style={{ color: '#38bdf8', fontSize: '0.82rem', textDecoration: 'none', fontWeight: 600 }}>Contact Us</Link>
        </div>
      </footer>
    </div>
  );
}
