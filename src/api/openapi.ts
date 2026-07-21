import { config } from '../config.js';

const pathParameter = (name: string) => ({
  name,
  in: 'path',
  required: true,
  schema: { type: 'string' },
});

const accountParameter = pathParameter('accountId');
const groupParameter = pathParameter('groupId');
const endpointParameter = pathParameter('endpointId');
const deliveryParameter = pathParameter('deliveryId');

const jsonBody = (schema: Record<string, unknown>) => ({
  required: true,
  content: { 'application/json': { schema } },
});

const object = (properties: Record<string, unknown>, required: string[] = []) => ({
  type: 'object', properties, ...(required.length ? { required } : {}),
});

export const openApiDocument = {
  openapi: '3.1.0',
  info: {
    title: 'Kortix WhatsApp Gateway API',
    version: '0.1.0',
    description: 'A browserless, multi-tenant, durable Baileys linked-device gateway for WhatsApp agents.',
  },
  servers: [{ url: config.PUBLIC_BASE_URL, description: 'Configured gateway' }],
  tags: [
    { name: 'System' },
    { name: 'Accounts' },
    { name: 'Pairing' },
    { name: 'Messages' },
    { name: 'Groups' },
    { name: 'Baileys' },
    { name: 'Webhooks' },
    { name: 'Agent access' },
  ],
  components: {
    securitySchemes: {
      apiKey: { type: 'apiKey', in: 'header', name: 'X-API-Key', description: 'Scoped Better Auth API key beginning with wag_' },
      session: { type: 'apiKey', in: 'cookie', name: 'better-auth.session_token', description: 'Better Auth browser session' },
    },
  },
  security: [{ apiKey: [] }, { session: [] }],
  paths: {
    '/health': {
      get: { tags: ['System'], summary: 'Health check', security: [], responses: { '200': { description: 'Gateway is healthy' } } },
    },
    '/openapi.json': {
      get: { tags: ['System'], summary: 'OpenAPI 3.1 document', security: [], responses: { '200': { description: 'OpenAPI JSON' } } },
    },
    '/docs': {
      get: { tags: ['System'], summary: 'Interactive Scalar API reference', security: [], responses: { '200': { description: 'Scalar HTML application' } } },
    },
    '/v1/skill.md': {
      get: { tags: ['Agent access'], summary: 'Download the generic agent skill', security: [], responses: { '200': { description: 'SKILL.md' } } },
    },
    '/v1/baileys-actions': {
      get: {
        tags: ['Baileys'], summary: 'List every managed Baileys socket action',
        responses: { '200': { description: 'Action name, socket method, ordered arguments, description, and required permission' } },
      },
    },
    '/v1/accounts/{accountId}/actions/{action}': {
      post: {
        tags: ['Baileys'], summary: 'Durably execute a managed Baileys socket action',
        parameters: [accountParameter, pathParameter('action')],
        requestBody: jsonBody(object({ args: { type: 'array', items: {}, default: [] } }, ['args'])),
        responses: {
          '200': { description: 'Action completed' }, '202': { description: 'Action is durably queued' },
          '403': { description: 'Missing action-specific permission' }, '404': { description: 'Account or action not found' },
        },
      },
    },
    '/v1/accounts': {
      get: { tags: ['Accounts'], summary: 'List accessible WhatsApp accounts', responses: { '200': { description: 'Accounts' } } },
      post: {
        tags: ['Accounts'], summary: 'Create a WhatsApp account connection',
        requestBody: jsonBody(object({ display_name: { type: 'string', maxLength: 80 }, phone_number: { type: 'string' } }, ['display_name'])),
        responses: { '201': { description: 'Account created' } },
      },
    },
    '/v1/accounts/{accountId}': {
      get: { tags: ['Accounts'], summary: 'Get an account', parameters: [accountParameter], responses: { '200': { description: 'Account' }, '404': { description: 'Not found' } } },
    },
    '/v1/accounts/{accountId}/status': {
      get: { tags: ['Accounts'], summary: 'Get connection and pairing status', description: 'Pairing secrets are returned only to sessions or keys with accounts:pair.', parameters: [accountParameter], responses: { '200': { description: 'Current status' } } },
    },
    '/v1/accounts/{accountId}/pair/qr': {
      post: {
        tags: ['Pairing'], summary: 'Start linked-device QR pairing', parameters: [accountParameter],
        requestBody: jsonBody(object({})),
        responses: { '200': { description: 'Fresh QR data URL' }, '202': { description: 'Pairing socket is starting' } },
      },
    },
    '/v1/accounts/{accountId}/pair/code': {
      post: {
        tags: ['Pairing'], summary: 'Request an eight-character phone pairing code', parameters: [accountParameter],
        requestBody: jsonBody(object({ phone_number: { type: 'string', description: 'E.164 phone number' } }, ['phone_number'])),
        responses: { '200': { description: 'Pairing code' }, '202': { description: 'Pairing request is queued' } },
      },
    },
    '/v1/accounts/{accountId}/session': {
      delete: { tags: ['Pairing'], summary: 'Log out and delete the linked-device session', parameters: [accountParameter], responses: { '200': { description: 'Disconnected' }, '202': { description: 'Disconnect is queued' } } },
    },
    '/v1/accounts/{accountId}/chats': {
      get: { tags: ['Messages'], summary: 'List synchronized chats', parameters: [accountParameter], responses: { '200': { description: 'Chats' } } },
    },
    '/v1/accounts/{accountId}/contacts': {
      get: { tags: ['Messages'], summary: 'List synchronized contacts', parameters: [accountParameter], responses: { '200': { description: 'Contacts' } } },
    },
    '/v1/accounts/{accountId}/messages': {
      get: {
        tags: ['Messages'], summary: 'List synchronized messages', parameters: [
          accountParameter,
          { name: 'chat_jid', in: 'query', schema: { type: 'string' } },
          { name: 'before', in: 'query', schema: { type: 'string', format: 'date-time' } },
          { name: 'limit', in: 'query', schema: { type: 'integer', minimum: 1, maximum: 200, default: 50 } },
        ], responses: { '200': { description: 'Messages and pagination cursor' } },
      },
      post: {
        tags: ['Messages'], summary: 'Send text or rich Baileys content', parameters: [accountParameter],
        requestBody: jsonBody(object({ to: { type: 'string', description: 'E.164 phone number or WhatsApp JID' }, text: { type: 'string' }, content: { type: 'object', additionalProperties: true } }, ['to'])),
        responses: { '200': { description: 'Message sent' }, '202': { description: 'Message is durably queued' } },
      },
    },
    '/v1/accounts/{accountId}/groups': {
      get: { tags: ['Groups'], summary: 'List synchronized groups', parameters: [accountParameter], responses: { '200': { description: 'Groups' } } },
      post: {
        tags: ['Groups'], summary: 'Create a group', parameters: [accountParameter],
        requestBody: jsonBody(object({ subject: { type: 'string' }, participants: { type: 'array', items: { type: 'string' }, minItems: 1 } }, ['subject', 'participants'])),
        responses: { '200': { description: 'Group created' }, '202': { description: 'Group creation is durably queued' } },
      },
    },
    '/v1/accounts/{accountId}/groups/{groupId}': {
      patch: {
        tags: ['Groups'], summary: 'Update a group subject or description', parameters: [accountParameter, groupParameter],
        requestBody: jsonBody(object({ subject: { type: 'string' }, description: { type: 'string' } })),
        responses: { '200': { description: 'Group updated' }, '202': { description: 'Update is queued' } },
      },
    },
    '/v1/accounts/{accountId}/groups/{groupId}/participants': {
      post: {
        tags: ['Groups'], summary: 'Add, remove, promote, or demote group participants', parameters: [accountParameter, groupParameter],
        requestBody: jsonBody(object({ participants: { type: 'array', items: { type: 'string' }, minItems: 1 }, action: { type: 'string', enum: ['add', 'remove', 'promote', 'demote'], default: 'add' } }, ['participants'])),
        responses: { '200': { description: 'Participants updated' }, '202': { description: 'Update is queued' } },
      },
    },
    '/v1/accounts/{accountId}/groups/{groupId}/participants/{participantId}': {
      delete: { tags: ['Groups'], summary: 'Remove one group participant', parameters: [accountParameter, groupParameter, pathParameter('participantId')], responses: { '200': { description: 'Participant removed' }, '202': { description: 'Removal is queued' } } },
    },
    '/v1/webhook-endpoints': {
      get: { tags: ['Webhooks'], summary: 'List webhook endpoints', responses: { '200': { description: 'Endpoints' } } },
      post: {
        tags: ['Webhooks'], summary: 'Create a signed webhook endpoint',
        requestBody: jsonBody(object({ url: { type: 'string', format: 'uri' }, description: { type: 'string' }, event_types: { type: 'array', items: { type: 'string' }, default: [] } }, ['url'])),
        responses: { '201': { description: 'Endpoint and one-time signing secret' } },
      },
    },
    '/v1/webhook-endpoints/{endpointId}': {
      delete: { tags: ['Webhooks'], summary: 'Delete a webhook endpoint', parameters: [endpointParameter], responses: { '204': { description: 'Deleted' }, '404': { description: 'Not found' } } },
    },
    '/v1/webhook-deliveries': {
      get: { tags: ['Webhooks'], summary: 'List the latest webhook deliveries', responses: { '200': { description: 'Latest 100 deliveries' } } },
    },
    '/v1/webhook-deliveries/{deliveryId}/replay': {
      post: { tags: ['Webhooks'], summary: 'Replay a webhook delivery', parameters: [deliveryParameter], responses: { '200': { description: 'Delivery reset to pending' }, '404': { description: 'Not found' } } },
    },
    '/v1/agent-access': {
      post: {
        tags: ['Agent access'], summary: 'Mint a scoped API key and personalized SKILL.md',
        requestBody: jsonBody(object({
          name: { type: 'string' }, account_ids: { type: 'array', items: { type: 'string' } },
          expires_in_seconds: { type: ['integer', 'null'], maximum: 31_536_000 },
          permissions: { type: 'object', additionalProperties: { type: 'array', items: { type: 'string' } } },
        })),
        responses: { '201': { description: 'Plaintext key and personalized skill, each shown once' }, '403': { description: 'Only a browser user may mint agent access' } },
      },
    },
  },
};
