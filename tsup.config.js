import { defineConfig } from 'tsup';

export default defineConfig([
  // Main entry (core blackbox)
  {
    entry: { 'index': 'src/index.js' },
    format: ['esm'],
    dts: false,
    outDir: 'dist',
    splitting: false,
    clean: true,
    external: ['react', 'react-dom', 'firebase', 'firebase/firestore', 'firebase/auth'],
    esbuildOptions(options) {
      options.loader = { '.js': 'jsx' };
      options.jsx = 'automatic';
    },
  },
  // Components — needs 'use client'
  {
    entry: { 'components/index': 'src/components/index.js' },
    format: ['esm'],
    dts: false,
    outDir: 'dist',
    splitting: false,
    external: ['react', 'react-dom', 'firebase', 'firebase/firestore', 'firebase/auth'],
    banner: { js: "'use client';" },
    esbuildOptions(options) {
      options.loader = { '.js': 'jsx' };
      options.jsx = 'automatic';
    },
  },
  // Firebase hooks
  {
    entry: { 'firebase': 'src/core/hooks/firebaseHook.js' },
    format: ['esm'],
    dts: false,
    outDir: 'dist',
    splitting: false,
    external: ['react', 'react-dom', 'firebase', 'firebase/firestore', 'firebase/auth'],
    esbuildOptions(options) {
      options.loader = { '.js': 'jsx' };
      options.jsx = 'automatic';
    },
  },
]);
