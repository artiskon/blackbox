'use client';

import { Component } from 'react';
import blackbox from '../core/blackbox.js';

const isProduction = typeof process !== 'undefined' && process.env && process.env.NODE_ENV === 'production';

class BlackBoxProvider extends Component {
  constructor(props) {
    super(props);
    this.state = { hasError: false, dismissed: false };
  }

  static getDerivedStateFromError() {
    return { hasError: true, dismissed: false };
  }

  componentDidCatch(error, info) {
    if (!isProduction) {
      try {
        blackbox.captureError(error, {
          source: 'react_boundary',
          componentStack: info?.componentStack || '',
        });
      } catch { /* ignore */ }
    }
  }

  render() {
    if (this.state.hasError && !this.state.dismissed) {
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
          <p style={{ color: '#333', fontSize: '16px', margin: '0 0 8px 0' }}>
            Something went wrong.
          </p>
          <p style={{ color: '#333', fontSize: '14px', margin: '0 0 20px 0' }}>
            The error has been recorded for debugging.
          </p>
          <div style={{ display: 'flex', gap: '12px' }}>
            <button
              onClick={() => this.setState({ hasError: false, dismissed: false })}
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
            <button
              onClick={() => this.setState({ dismissed: true })}
              style={{
                padding: '8px 20px',
                border: '1px solid #999',
                borderRadius: '4px',
                background: 'white',
                cursor: 'pointer',
                fontSize: '14px',
              }}
            >
              Dismiss
            </button>
          </div>
        </div>
      );
    }

    return this.props.children;
  }
}

export default BlackBoxProvider;
