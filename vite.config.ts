import { defineConfig } from 'vite';
import { pencilRooms } from './server/devroom';

export default defineConfig({
  plugins: [pencilRooms()],
  server: {
    host: '0.0.0.0',
    port: 5173,
    strictPort: false,
    allowedHosts: true,
  },
  build: {
    target: 'es2022',
    chunkSizeWarningLimit: 1400,
  },
});
