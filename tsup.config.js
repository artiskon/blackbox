import { defineConfig } from 'tsup';

export default defineConfig({
  entry: {
    'index': 'src/index.js',
    'components/index': 'src/components/index.js',
    'firebase': 'src/core/hooks/firebaseHook.js',
    'storage': 'src/core/hooks/storageHook.js',
  },
  format: ['esm'],
  splitting: true,
  dts: false,
  outDir: 'dist',
  clean: true,
  external: ['react', 'react-dom', 'firebase', 'firebase/firestore', 'firebase/auth'],
  // Per-entry 'use client' directives live in the source files that need them
  // (src/components/*). A blanket banner over-applies the directive to
  // server-safe entries (firebase.js, storage.js) and breaks Next.js App
  // Router consumers that import bbWrapWrites / bbR2Fetch from shared
  // services reachable by route handlers — Next then refuses the import
  // with "Attempted to call X() from the server" even though the function
  // itself is server-safe. Caught in v1.9.0 by an agent debugging
  // /api/admin/clear-cache.
  esbuildOptions(options) {
    options.loader = { '.js': 'jsx' };
    options.jsx = 'automatic';
  },
  async onSuccess() {
    const { copyFile, mkdir } = await import('fs/promises');
    await mkdir('dist/components', { recursive: true });
    await copyFile('src/index.d.ts', 'dist/index.d.ts');
    await copyFile('src/components/index.d.ts', 'dist/components/index.d.ts');
    await copyFile('src/firebase.d.ts', 'dist/firebase.d.ts');
    await copyFile('src/storage.d.ts', 'dist/storage.d.ts');
    console.log('Copied .d.ts files to dist/');
  },
});
