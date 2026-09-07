import React, { useState } from 'react';
import { Link } from 'react-router-dom';
import Logo from './Logo.jsx';
import styles from './ContactPage.module.css';

export default function ContactPage() {
  const [formData, setFormData] = useState({
    name: '',
    email: '',
    category: 'research',
    subject: '',
    message: ''
  });
  const [submitted, setSubmitted] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);

  const handleChange = (e) => {
    setFormData({
      ...formData,
      [e.target.name]: e.target.value
    });
  };

  const handleSubmit = (e) => {
    e.preventDefault();
    setIsSubmitting(true);
    // Simulated UI submission (Ready for backend email integration)
    setTimeout(() => {
      setIsSubmitting(false);
      setSubmitted(true);
      setFormData({
        name: '',
        email: '',
        category: 'research',
        subject: '',
        message: ''
      });
    }, 600);
  };

  return (
    <div className={styles.pageWrapper}>
      {/* Generic Unified Header for All Users */}
      <header className={styles.header}>
        <div className={styles.headerLeft}>
          <Link to="/" className={styles.logoLink} title="Return to Home">
            <Logo size="medium" subtitle="Research Inquiries, Collaboration, and Technical Support" />
          </Link>
        </div>

        <nav className={styles.toolbar}>
          <Link to="/" className={styles.toolbarBtn}>
            Home
          </Link>
          <Link to="/simulator" className={styles.toolbarBtn}>
            Simulator
          </Link>
          <Link to="/saved-simulations" className={styles.toolbarBtn}>
            Saved Archives
          </Link>
          <Link to="/docs" className={styles.toolbarBtn}>
            Docs
          </Link>
          <Link to="/contact" className={`${styles.toolbarBtn} ${styles.toolbarBtnActive}`}>
            Contact
          </Link>
        </nav>
      </header>

      {/* Main Container */}
      <main className={styles.mainContainer}>
        {/* Intro Hero */}
        <div className={styles.introHero}>
          <div className={styles.badgeLabel}>GET IN TOUCH</div>
          <h1>Contact the Traffic Research Team</h1>
          <p>
            Have questions regarding the Greedy Lookahead optimization algorithms, OpenStreetMap integration, or academic research collaborations? Send us a message or connect directly with our lab.
          </p>
        </div>

        {/* Grid: Form (Left) & Lab Info (Right) */}
        <div className={styles.contentGrid}>
          {/* Contact Form Card */}
          <div className={styles.formCard}>
            <div className={styles.cardHeader}>
              <h2>Send an Inquiry</h2>
              <p>Fill out the details below and our research group will get back to you promptly.</p>
            </div>

            {submitted && (
              <div className={styles.successAlert}>
                <div className={styles.successIconBox}>
                  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" className={styles.checkIcon}>
                    <polyline points="20 6 9 17 4 12"></polyline>
                  </svg>
                </div>
                <div className={styles.successText}>
                  <strong>Inquiry Received Successfully</strong>
                  <p>Thank you for reaching out! Your message has been logged for our research engineering team. We typically respond within 24 business hours.</p>
                </div>
                <button 
                  className={styles.resetBtn}
                  onClick={() => setSubmitted(false)}
                >
                  Send Another Message
                </button>
              </div>
            )}

            {!submitted && (
              <form onSubmit={handleSubmit} className={styles.form}>
                <div className={styles.formRow}>
                  <div className={styles.formGroup}>
                    <label htmlFor="name">Full Name *</label>
                    <input
                      id="name"
                      type="text"
                      name="name"
                      value={formData.name}
                      onChange={handleChange}
                      placeholder="e.g. Dr. Alex Mercer"
                      required
                    />
                  </div>

                  <div className={styles.formGroup}>
                    <label htmlFor="email">Email Address *</label>
                    <input
                      id="email"
                      type="email"
                      name="email"
                      value={formData.email}
                      onChange={handleChange}
                      placeholder="e.g. researcher@institution.edu"
                      required
                    />
                  </div>
                </div>

                <div className={styles.formRow}>
                  <div className={styles.formGroup}>
                    <label htmlFor="category">Inquiry Type</label>
                    <select
                      id="category"
                      name="category"
                      value={formData.category}
                      onChange={handleChange}
                    >
                      <option value="research">Academic &amp; Research Collaboration</option>
                      <option value="algorithm">Algorithm Optimization &amp; Math Modeling</option>
                      <option value="bug">Technical Issue / Bug Report</option>
                      <option value="feature">Feature Request / Dataset Integration</option>
                      <option value="general">General Inquiries</option>
                    </select>
                  </div>

                  <div className={styles.formGroup}>
                    <label htmlFor="subject">Subject *</label>
                    <input
                      id="subject"
                      type="text"
                      name="subject"
                      value={formData.subject}
                      onChange={handleChange}
                      placeholder="e.g. Evaluation on 8x8 Grid Datasets"
                      required
                    />
                  </div>
                </div>

                <div className={styles.formGroup}>
                  <label htmlFor="message">Message *</label>
                  <textarea
                    id="message"
                    name="message"
                    rows="6"
                    value={formData.message}
                    onChange={handleChange}
                    placeholder="Provide details about your inquiry, scenario parameters, or collaboration proposal..."
                    required
                  ></textarea>
                </div>

                <div className={styles.formActions}>
                  <button 
                    type="submit" 
                    className={styles.submitBtn} 
                    disabled={isSubmitting}
                  >
                    {isSubmitting ? 'Dispatching Message...' : 'Send Message'}
                  </button>
                  <span className={styles.formHint}>All inquiries are routed to the Plaksha Traffic Lab inbox.</span>
                </div>
              </form>
            )}
          </div>

          {/* Contact Details & Lab Info */}
          <div className={styles.infoCol}>
            {/* Direct Contact Card */}
            <div className={styles.infoCard}>
              <h3>Contact Details</h3>
              
              <div className={styles.infoItem}>
                <div className={styles.itemIconBox}>
                  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className={styles.infoIcon}>
                    <path d="M4 4h16c1.1 0 2 .9 2 2v12c0 1.1-.9 2-2 2H4c-1.1 0-2-.9-2-2V6c0-1.1.9-2 2-2z"/>
                    <polyline points="22,6 12,13 2,6"/>
                  </svg>
                </div>
                <div className={styles.itemContent}>
                  <span className={styles.itemLabel}>Primary Email</span>
                  <a href="mailto:traffic-research@plaksha.edu.in" className={styles.itemValueLink}>
                    traffic-research@plaksha.edu.in
                  </a>
                </div>
              </div>

              <div className={styles.infoItem}>
                <div className={styles.itemIconBox}>
                  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className={styles.infoIcon}>
                    <path d="M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0 1 18 0z"/>
                    <circle cx="12" cy="10" r="3"/>
                  </svg>
                </div>
                <div className={styles.itemContent}>
                  <span className={styles.itemLabel}>Research Lab Location</span>
                  <span className={styles.itemValue}>
                    Plaksha University Campus, Sector 101A, IT City, SAS Nagar (Mohali), Punjab 140306, India
                  </span>
                </div>
              </div>

              <div className={styles.infoItem}>
                <div className={styles.itemIconBox}>
                  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className={styles.infoIcon}>
                    <circle cx="12" cy="12" r="10"/>
                    <polyline points="12 6 12 12 16 14"/>
                  </svg>
                </div>
                <div className={styles.itemContent}>
                  <span className={styles.itemLabel}>Operating Hours</span>
                  <span className={styles.itemValue}>Monday – Friday: 09:00 to 18:00 IST</span>
                  <span className={styles.itemSubtext}>Response turnaround typically under 24 business hours</span>
                </div>
              </div>
            </div>
          </div>
        </div>
      </main>

      {/* Footer */}
      <footer className={styles.footer}>
        <div className={styles.footerLinks}>
          <Link to="/" className={styles.footerLink}>Home</Link>
          <span className={styles.footerDot}>•</span>
          <Link to="/simulator" className={styles.footerLink}>Simulator</Link>
          <span className={styles.footerDot}>•</span>
          <Link to="/docs" className={styles.footerLink}>Documentation</Link>
          <span className={styles.footerDot}>•</span>
          <Link to="/saved-simulations" className={styles.footerLink}>Saved Archives</Link>
          <span className={styles.footerDot}>•</span>
          <Link to="/contact" className={styles.footerLink}>Contact Us</Link>
        </div>
        <p>© 2026 GreenWave Mobility. Developed for Plaksha Advanced Traffic Research Systems.</p>
      </footer>
    </div>
  );
}
