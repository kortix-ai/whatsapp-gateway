import { fileURLToPath, URL } from 'node:url';
import { defineConfig, type ProxyOptions } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';

// Dev-only: the API validates the request Origin against WEB_ORIGIN. When the
// gateway runs with WEB_ORIGIN pointing at its own host (e.g. localhost:8080),
// align the proxied Origin so Better Auth accepts dev requests from Vite.
const DEV_API_ORIGIN = process.env.WHATSAPP_GATEWAY_DEV_ORIGIN ?? 'http://localhost:8080';
const rewriteOrigin: NonNullable<ProxyOptions['configure']> = (proxy) => {
  proxy.on('proxyReq', (proxyReq) => proxyReq.setHeader('origin', DEV_API_ORIGIN));
};

export default defineConfig({
  plugins: [react(), tailwindcss()],
  root: 'src/web',
  resolve: {
    alias: {
      '@': fileURLToPath(new URL('./src/web', import.meta.url)),
    },
  },
  build: {
    outDir: '../../dist/web',
    emptyOutDir: true,
  },
  server: {
    port: 3000,
    proxy: {
      '/api': { target: 'http://localhost:8080', changeOrigin: true, configure: rewriteOrigin },
      '/v1': { target: 'http://localhost:8080', changeOrigin: true, configure: rewriteOrigin },
      '/health': 'http://localhost:8080',
      '/openapi.json': 'http://localhost:8080',
      '/docs': 'http://localhost:8080',
    },
  },
});
