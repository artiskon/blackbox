import { defineConfig } from 'tsup';

export default defineConfig([
  // Main entry (core blackbox) — no 'use client' needed
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
    },
  },
  // Firebase hooks — no 'use client' needed
  {
    entry: { 'firebase': 'src/core/hooks/firebaseHook.js' },
    format: ['esm'],
    dts: false,
    outDir: 'dist',
    splitting: false,
    external: ['react', 'react-dom', 'firebase', 'firebase/firestore', 'firebase/auth'],
    esbuildOptions(options) {
      options.loader = { '.js': 'jsx' };
    },
  },
]);
