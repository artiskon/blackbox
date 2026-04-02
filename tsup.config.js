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
  async onSuccess() {
    const { copyFile, mkdir } = await import('fs/promises');
    await mkdir('dist/components', { recursive: true });
    await copyFile('src/index.d.ts', 'dist/index.d.ts');
    await copyFile('src/components/index.d.ts', 'dist/components/index.d.ts');
    await copyFile('src/firebase.d.ts', 'dist/firebase.d.ts');
    console.log('Copied .d.ts files to dist/');
  },
});
