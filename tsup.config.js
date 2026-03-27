import { defineConfig } from 'tsup';

export default defineConfig({
  entry: {
    'index': 'src/index.js',
    'components/index': 'src/components/index.js',
    'firebase': 'src/core/hooks/firebaseHook.js',
  },
  format: ['esm'],
  splitting: true,
  dts: false,
  outDir: 'dist',
  clean: true,
  external: ['react', 'react-dom', 'firebase', 'firebase/firestore', 'firebase/auth'],
  banner: { js: "'use client';" },
  esbuildOptions(options) {
    options.loader = { '.js': 'jsx' };
    options.jsx = 'automatic';
  },
});
