import { Scalar } from '@scalar/hono-api-reference';
import { Hono } from 'hono';
import { cors } from 'hono/cors';
import { HTTPException } from 'hono/http-exception';
import { auth } from '../auth/auth.js';
import type { GatewayVariables } from '../auth/middleware.js';
import { config } from '../config.js';
import { prisma } from '../db/prisma.js';
import { logger } from '../logger.js';
import { buildAgentCapabilities, buildAgentSkill, buildChatSkill } from '../skill.js';
import { IdempotencyConflictError } from '../services/commands.js';
import { openApiDocument } from './openapi.js';
import { accountRoutes } from './routes/accounts.js';
import { apiKeyRoutes } from './routes/api-keys.js';
import { chatContactRoutes } from './routes/chats-contacts.js';
import { commandRoutes } from './routes/commands.js';
import { groupRoutes } from './routes/groups.js';
import { mediaRoutes } from './routes/media.js';
import { messageRoutes } from './routes/messages.js';
import { webhookRoutes } from './routes/webhooks.js';

const app = new Hono<{ Variables: GatewayVariables }>();

app.use('*', cors({
  origin: config.WEB_ORIGIN,
  credentials: true,
  allowHeaders: ['content-type', 'authorization', 'x-api-key', 'idempotency-key'],
  allowMethods: ['GET', 'POST', 'PATCH', 'DELETE', 'OPTIONS'],
}));

app.get('/health', (context) => context.json({ status: 'ok', service: 'whatsapp-gateway', release: config.GATEWAY_RELEASE }));
app.get('/health/ready', async (context) => {
  try {
    await prisma.$queryRaw`SELECT 1`;
    return context.json({ status: 'ready', service: 'whatsapp-gateway', release: config.GATEWAY_RELEASE });
  } catch (error) {
    logger.error({ error }, 'Readiness check failed');
    return context.json({ status: 'not_ready', service: 'whatsapp-gateway', release: config.GATEWAY_RELEASE }, 503);
  }
});
app.get('/openapi.json', (context) => context.json(openApiDocument));
app.get('/docs', Scalar({
  url: '/openapi.json',
  pageTitle: 'WhatsApp Gateway API',
  theme: 'kepler',
  layout: 'modern',
  hideClientButton: false,
  persistAuth: true,
}));
app.get('/v1/skill.md', (context) => context.text(buildAgentSkill(), 200, { 'content-type': 'text/markdown; charset=utf-8' }));
app.get('/v1/chat.md', (context) => context.text(buildChatSkill(), 200, { 'content-type': 'text/markdown; charset=utf-8' }));
app.get('/v1/capabilities.md', (context) => context.text(buildAgentCapabilities(), 200, { 'content-type': 'text/markdown; charset=utf-8' }));
app.on(['GET', 'POST'], '/api/auth/*', (context) => auth.handler(context.req.raw));

// Routers keep their full /v1/... path literals (mounted at '/') so every route
// string stays greppable and the doc-coverage tests can scan them as source.
app.route('/', accountRoutes);
app.route('/', commandRoutes);
app.route('/', chatContactRoutes);
app.route('/', messageRoutes);
app.route('/', mediaRoutes);
app.route('/', groupRoutes);
app.route('/', apiKeyRoutes);
app.route('/', webhookRoutes);

app.onError((error, context) => {
  if (error instanceof IdempotencyConflictError) return context.json({ error: 'idempotency_conflict', message: error.message }, 409);
  if (error instanceof HTTPException) return context.json({ error: 'request_error', message: error.message }, error.status);
  console.error(error);
  return context.json({ error: 'internal_error', message: config.NODE_ENV === 'development' ? error.message : 'Internal server error' }, 500);
});

export { app };
