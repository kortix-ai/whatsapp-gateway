import { serve } from '@hono/node-server';
import { serveStatic } from '@hono/node-server/serve-static';
import { app } from './api/app.js';
import { config } from './config.js';
import { prisma } from './db/prisma.js';
import { logger } from './logger.js';
import { startWebhookDispatcher, type WebhookDispatcher } from './webhooks/dispatcher.js';
import { startWorker, type SessionSupervisor } from './worker/supervisor.js';

let supervisor: SessionSupervisor | undefined;
let dispatcher: WebhookDispatcher | undefined;
let server: ReturnType<typeof serve> | undefined;

if (config.RUNTIME_ROLE === 'api' || config.RUNTIME_ROLE === 'all') {
  if (config.NODE_ENV === 'production') {
    app.use('/assets/*', serveStatic({ root: './dist/web' }));
    app.get('/', serveStatic({ path: './dist/web/index.html' }));
    app.get('/favicon.svg', serveStatic({ path: './dist/web/favicon.svg' }));
    // Single-page-app fallback: any browser GET that is not an API, docs, or
    // static-asset route resolves to the client shell so deep links and hard
    // refreshes (e.g. /app/numbers/:id/chats) load the router instead of 404ing.
    const apiPrefixes = ['/v1', '/api', '/health', '/openapi.json', '/docs', '/assets'];
    app.get('*', (context, next) => {
      const path = context.req.path;
      if (apiPrefixes.some((prefix) => path === prefix || path.startsWith(`${prefix}/`))) return next();
      return serveStatic({ path: './dist/web/index.html' })(context, next);
    });
  }
  server = serve({ fetch: app.fetch, port: config.PORT }, (info) => {
    logger.info({ port: info.port }, 'WhatsApp Gateway API listening');
  });
}

if (config.RUNTIME_ROLE === 'worker' || config.RUNTIME_ROLE === 'all') supervisor = startWorker();
if (config.RUNTIME_ROLE === 'webhooks' || config.RUNTIME_ROLE === 'all') dispatcher = startWebhookDispatcher();

async function shutdown(signal: string) {
  logger.info({ signal }, 'Shutting down');
  server?.close();
  dispatcher?.stop();
  await supervisor?.stop();
  await prisma.$disconnect();
  process.exit(0);
}

process.on('SIGTERM', () => void shutdown('SIGTERM'));
process.on('SIGINT', () => void shutdown('SIGINT'));
