import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';
import { ISOLATION_HEADERS } from './src/lib/isolation-headers.js';

export default defineConfig({
  plugins: [react(), tailwindcss()],
  resolve: {
    alias: [
      {
        // y-monaco 0.1.6 predates monaco-editor 0.57's exports map and still
        // imports the old deep path, which the map no longer exposes.
        find: 'monaco-editor/esm/vs/editor/editor.api.js',
        replacement: 'monaco-editor/editor/editor.api.js',
      },
    ],
  },
  // Every response, including the Monaco worker scripts, is cross-origin
  // isolated, in development and in `vite preview` (which e2e runs against).
  server: { port: 5173, strictPort: true, headers: ISOLATION_HEADERS },
  preview: { port: 4173, strictPort: true, headers: ISOLATION_HEADERS },
  build: {
    // Monaco is large and split across chunks; this silences the default
    // 500 kB warning without hiding genuinely surprising growth.
    chunkSizeWarningLimit: 1200,
  },
});
