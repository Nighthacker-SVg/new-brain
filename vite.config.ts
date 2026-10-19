import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  base: './',
  server: { host: '0.0.0.0', allowedHosts: ['terminal.local'], proxy: { '/api': 'http://127.0.0.1:8080' } },
  // Only the generated public site is shared with opaque preview frames.
  // Keep development source access restricted by Vite's default CORS policy.
  preview: { host: '0.0.0.0', allowedHosts: ['terminal.local'], cors: true },
});
