import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// Порт бэкенда настраивается: VIBEDND_API=http://localhost:3002 npm run dev
const API = process.env.VIBEDND_API ?? 'http://localhost:3001';

export default defineConfig({
  plugins: [react()],
  server: {
    host: true, // слушаем 0.0.0.0 — телефоны в той же Wi-Fi сети
    port: 5173,
    proxy: {
      '/api': API,
      '/uploads': API,
      '/ws': { target: API.replace(/^http/, 'ws'), ws: true },
    },
  },
});
