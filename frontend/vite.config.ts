import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// https://vite.dev/config/
export default defineConfig({
  plugins: [react()],
  server: {
    // 127.0.0.1 evita ambigüedad IPv6/localhost y reduce errores tipo net::ERR_HTTP2_PROTOCOL_ERROR con el proxy.
    host: '127.0.0.1',
    port: 5173,
    proxy: {
      // Mismo origen en dev: el front usa VITE_API_URL=/api/v1 y Vite reenvía al backend (evita CORS y fallos con localhost/IPv6).
      '/api': {
        target: 'http://127.0.0.1:8000',
        changeOrigin: true,
      },
      '/uploads': {
        target: 'http://127.0.0.1:8000',
        changeOrigin: true,
      },
    },
  },
  build: {
    chunkSizeWarningLimit: 900,
    rollupOptions: {
      output: {
        manualChunks(id) {
          if (!id.includes('node_modules')) return undefined;
          if (id.includes('@tanstack/react-query')) return 'query-vendor';
          if (id.includes('recharts')) return 'charts-vendor';
          if (id.includes('jspdf') || id.includes('html2canvas') || id.includes('dompurify')) return 'pdf-vendor';
          if (id.includes('lucide-react')) return 'icons-vendor';
          return undefined;
        },
      },
    },
  },
});
