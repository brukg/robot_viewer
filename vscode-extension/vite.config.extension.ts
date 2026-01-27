import { defineConfig } from 'vite';
import { resolve } from 'path';

export default defineConfig({
  build: {
    lib: {
      entry: resolve(__dirname, 'src/extension.ts'),
      formats: ['cjs'],
      fileName: () => 'extension.js',
    },
    outDir: 'dist',
    emptyOutDir: false,
    sourcemap: true,
    minify: false,
    rollupOptions: {
      external: [
        'vscode',
        'path',
        'fs',
        'os',
        'util',
        'events',
        'stream',
        'buffer',
        'url',
      ],
      output: {
        format: 'cjs',
        entryFileNames: 'extension.js',
        globals: {
          vscode: 'vscode',
        },
      },
    },
  },
  resolve: {
    alias: {
      '@shared': resolve(__dirname, '../src'),
    },
  },
});
