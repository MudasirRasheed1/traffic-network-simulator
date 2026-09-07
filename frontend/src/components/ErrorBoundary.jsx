import React from 'react';

export default class ErrorBoundary extends React.Component {
  constructor(props) {
    super(props);
    this.state = { hasError: false, errorMessage: '' };
  }

  static getDerivedStateFromError(error) {
    return {
      hasError: true,
      errorMessage: error?.message || 'Unknown rendering error',
    };
  }

  componentDidCatch(error, errorInfo) {
    console.error('ErrorBoundary caught:', error, errorInfo);
  }

  render() {
    if (this.state.hasError) {
      return (
        <div style={{ background: '#1a1a2e', border: '1px solid #2d2d44', borderRadius: 12, padding: 16, color: '#cbd5e1' }}>
          <h3 style={{ marginTop: 0, marginBottom: 8 }}>Map Panel Failed to Render</h3>
          <div style={{ fontSize: '0.85rem', color: '#94a3b8', marginBottom: 8 }}>
            The simulator is still available. You can continue running scenarios.
          </div>
          <pre style={{ margin: 0, whiteSpace: 'pre-wrap', fontSize: '0.75rem', color: '#fca5a5' }}>{this.state.errorMessage}</pre>
        </div>
      );
    }

    return this.props.children;
  }
}
