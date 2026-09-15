'use client';

import { Component } from 'react';
import blackbox from '../core/blackbox.js';

class BlackBoxProvider extends Component {
  constructor(props) {
    super(props);
    this.state = { hasError: false };
  }

  static getDerivedStateFromError() {
    return { hasError: true };
  }

  componentDidCatch(error, info) {
    // _recordError no-ops unless init() enabled BB, so enabled/NODE_ENV is
    // honored there. Called directly (not captureError) so the entry keeps
    // source 'react_boundary' instead of 'manual'.
    try {
      blackbox._recordError({
        message: error?.message || String(error),
        stack: error?.stack || '',
        source: 'react_boundary',
        context: { componentStack: info?.componentStack || '' },
      });
    } catch { /* ignore */ }
  }

  render() {
    if (this.state.hasError) {
      if (this.props.fallback) {
        return this.props.fallback;
      }

      return (
        <div style={{
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          justifyContent: 'center',
          padding: '32px',
          background: '#f5f5f5',
          borderRadius: '8px',
          textAlign: 'center',
        }}>
          <p style={{ color: '#333', fontSize: '16px', margin: '0 0 20px 0' }}>
            Something went wrong.
          </p>
          <button
            onClick={() => this.setState({ hasError: false })}
            style={{
              padding: '8px 20px',
              border: '1px solid #999',
              borderRadius: '4px',
              background: 'white',
              cursor: 'pointer',
              fontSize: '14px',
            }}
          >
            Try Again
          </button>
        </div>
      );
    }

    return this.props.children;
  }
}

export default BlackBoxProvider;
