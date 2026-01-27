import { defineConfig } from 'vite';
import { resolve } from 'path';

export default defineConfig({
  root: resolve(__dirname, 'webview'),
  build: {
    outDir: resolve(__dirname, 'dist/webview'),
    emptyOutDir: true,
    sourcemap: true,
    rollupOptions: {
      input: {
        main: resolve(__dirname, 'webview/index.html'),
      },
      output: {
        entryFileNames: 'assets/[name].js',
        chunkFileNames: 'assets/[name].js',
        assetFileNames: 'assets/[name].[ext]',
        manualChunks: {
          three: ['three'],
          mujoco: ['mujoco-js'],
          d3: ['d3'],
        },
      },
    },
    chunkSizeWarningLimit: 15000, // MuJoCo WASM is large
  },
  resolve: {
    alias: {
      '@shared': resolve(__dirname, '../src'),
    },
  },
  define: {
    'process.env.NODE_ENV': JSON.stringify('production'),
  },
});
