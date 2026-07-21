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
const commandParameter = pathParameter('commandId');
const keyParameter = pathParameter('keyId');
const idempotencyParameter = {
  name: 'Idempotency-Key', in: 'header', required: false,
  description: 'Client-generated retry key, unique per tenant and durable command.',
  schema: { type: 'string', maxLength: 200 },
};

const jsonBody = (schema: Record<string, unknown>) => ({
  required: true,
  content: { 'application/json': { schema } },
});

const object = (properties: Record<string, unknown>, required: string[] = []) => ({
  type: 'object', properties, ...(required.length ? { required } : {}),
});

const jsonResponse = (description: string, schema: Record<string, unknown>) => ({
  description,
  content: { 'application/json': { schema } },
});

const commandResponse = (description: string) => jsonResponse(description, { $ref: '#/components/schemas/CommandEnvelope' });

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
    { name: 'API keys' },
  ],
  components: {
    securitySchemes: {
      apiKey: { type: 'apiKey', in: 'header', name: 'X-API-Key', description: 'Scoped Better Auth API key beginning with wag_' },
      session: { type: 'apiKey', in: 'cookie', name: 'better-auth.session_token', description: 'Better Auth browser session' },
    },
    schemas: {
      CommandEnvelope: object({
        command_id: { type: 'string', examples: ['cmd_0123456789abcdef'] },
        account_id: { type: 'string', examples: ['wa_0123456789abcdef'] },
        type: { type: 'string', examples: ['socket.action'] },
        status: { type: 'string', enum: ['pending', 'processing', 'completed', 'failed'] },
        result: { type: ['object', 'array', 'string', 'number', 'boolean', 'null'] },
        error: { type: ['string', 'null'] },
        attempt_count: { type: 'integer', minimum: 0 },
        idempotency_key: { type: ['string', 'null'] },
        created_at: { type: 'string', format: 'date-time' },
        updated_at: { type: 'string', format: 'date-time' },
        completed_at: { type: ['string', 'null'], format: 'date-time' },
      }, ['command_id', 'account_id', 'type', 'status', 'result', 'error', 'attempt_count', 'idempotency_key', 'created_at', 'updated_at', 'completed_at']),
      Error: object({
        error: { type: 'string' },
        message: { type: 'string' },
      }, ['error', 'message']),
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
      get: { tags: ['API keys'], summary: 'Download the generic agent skill', security: [], responses: { '200': { description: 'SKILL.md' } } },
    },
    '/v1/capabilities.md': {
      get: { tags: ['API keys'], summary: 'Compact token-efficient capability map', security: [], responses: { '200': { description: 'Capability Markdown' } } },
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
        parameters: [accountParameter, pathParameter('action'), idempotencyParameter],
        requestBody: jsonBody(object({ args: { type: 'array', items: {}, default: [] } }, ['args'])),
        responses: {
          '200': commandResponse('Action reached a completed or failed terminal state'), '202': commandResponse('Action is pending or processing'),
          '409': jsonResponse('Idempotency key was reused for different work', { $ref: '#/components/schemas/Error' }),
          '403': { description: 'Missing action-specific permission' }, '404': { description: 'Account or action not found' },
        },
      },
    },
    '/v1/commands/{commandId}': {
      get: {
        tags: ['Baileys'], summary: 'Get or long-poll a durable command', parameters: [commandParameter, { name: 'wait_seconds', in: 'query', schema: { type: 'integer', minimum: 0, maximum: 30, default: 0 } }],
        responses: { '200': commandResponse('Pending, processing, completed, or failed command'), '404': { description: 'Command not found' } },
      },
    },
    '/v1/events': {
      get: {
        tags: ['Webhooks'], summary: 'List normalized durable WhatsApp events', parameters: [
          { name: 'account_id', in: 'query', schema: { type: 'string' } },
          { name: 'type', in: 'query', schema: { type: 'string' } },
          { name: 'after_sequence', in: 'query', schema: { type: 'integer', minimum: 0 } },
          { name: 'since', in: 'query', schema: { type: 'string', format: 'date-time' } },
          { name: 'limit', in: 'query', schema: { type: 'integer', minimum: 1, maximum: 500, default: 100 } },
        ], responses: { '200': { description: 'Ordered events and next sequence cursor' } },
      },
    },
    '/v1/api-keys': {
      get: { tags: ['API keys'], summary: 'List account and connection API keys', responses: { '200': { description: 'Safe API-key metadata' }, '403': { description: 'Owner session required' } } },
      post: {
        tags: ['API keys'], summary: 'Create an account- or connection-scoped API key',
        requestBody: jsonBody(object({
          name: { type: 'string' }, scope: { type: 'string', enum: ['account', 'connection'], default: 'connection' },
          account_id: { type: 'string' }, expires_in_seconds: { type: ['integer', 'null'], maximum: 31_536_000 },
          permissions: { type: 'object', additionalProperties: { type: 'array', items: { type: 'string' } } },
        }, ['name', 'scope'])),
        responses: { '201': { description: 'Plaintext API key returned once' }, '403': { description: 'Owner session required' } },
      },
    },
    '/v1/api-keys/{keyId}': {
      delete: { tags: ['API keys'], summary: 'Revoke an API key', parameters: [keyParameter], responses: { '204': { description: 'Revoked' }, '404': { description: 'Not found' } } },
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
      get: { tags: ['Accounts'], summary: 'Get connection and pairing status', description: 'General status is safe for API keys; pairing credentials are returned only to the signed-in owner or by an explicit pairing operation.', parameters: [accountParameter], responses: { '200': { description: 'Current status' } } },
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
        tags: ['Pairing'], summary: 'Request an eight-character phone pairing code', parameters: [accountParameter, idempotencyParameter],
        requestBody: jsonBody(object({ phone_number: { type: 'string', description: 'E.164 phone number' } }, ['phone_number'])),
        responses: { '200': commandResponse('Pairing request reached a terminal state'), '202': commandResponse('Pairing request is queued') },
      },
    },
    '/v1/accounts/{accountId}/session': {
      delete: { tags: ['Pairing'], summary: 'Log out and delete the linked-device session', parameters: [accountParameter, idempotencyParameter], responses: { '200': commandResponse('Disconnect reached a terminal state'), '202': commandResponse('Disconnect is queued') } },
    },
    '/v1/accounts/{accountId}/chats': {
      get: { tags: ['Messages'], summary: 'List synchronized chats', parameters: [accountParameter, { name: 'q', in: 'query', schema: { type: 'string' } }, { name: 'unread', in: 'query', schema: { type: 'boolean' } }, { name: 'archived', in: 'query', schema: { type: 'boolean' } }], responses: { '200': { description: 'Chats' } } },
    },
    '/v1/accounts/{accountId}/contacts': {
      get: { tags: ['Messages'], summary: 'List synchronized contacts', parameters: [accountParameter, { name: 'q', in: 'query', schema: { type: 'string' } }], responses: { '200': { description: 'Contacts' } } },
    },
    '/v1/accounts/{accountId}/messages': {
      get: {
        tags: ['Messages'], summary: 'List synchronized messages', parameters: [
          accountParameter,
          { name: 'chat_jid', in: 'query', schema: { type: 'string' } },
          { name: 'before', in: 'query', schema: { type: 'string', format: 'date-time' } },
          { name: 'limit', in: 'query', schema: { type: 'integer', minimum: 1, maximum: 200, default: 50 } },
          { name: 'unread', in: 'query', schema: { type: 'boolean' } },
          { name: 'direction', in: 'query', schema: { type: 'string', enum: ['inbound', 'outbound'] } },
          { name: 'status', in: 'query', schema: { type: 'string' } },
          { name: 'type', in: 'query', schema: { type: 'string' } },
          { name: 'sender_jid', in: 'query', schema: { type: 'string' } },
          { name: 'since', in: 'query', schema: { type: 'string', format: 'date-time' } },
        ], responses: { '200': { description: 'Messages and pagination cursor' } },
      },
      post: {
        tags: ['Messages'], summary: 'Send text or rich Baileys content', parameters: [accountParameter, idempotencyParameter],
        requestBody: jsonBody(object({ to: { type: 'string', description: 'E.164 phone number or WhatsApp JID' }, text: { type: 'string' }, content: { type: 'object', additionalProperties: true } }, ['to'])),
        responses: { '200': commandResponse('Message command reached a terminal state'), '202': commandResponse('Message is durably queued'), '409': { description: 'Idempotency conflict' } },
      },
    },
    '/v1/accounts/{accountId}/groups': {
      get: { tags: ['Groups'], summary: 'List synchronized groups', parameters: [accountParameter, { name: 'q', in: 'query', schema: { type: 'string' } }], responses: { '200': { description: 'Groups' } } },
      post: {
        tags: ['Groups'], summary: 'Create a group', parameters: [accountParameter, idempotencyParameter],
        requestBody: jsonBody(object({ subject: { type: 'string' }, participants: { type: 'array', items: { type: 'string' }, minItems: 1 } }, ['subject', 'participants'])),
        responses: { '200': commandResponse('Group command reached a terminal state'), '202': commandResponse('Group creation is durably queued'), '409': { description: 'Idempotency conflict' } },
      },
    },
    '/v1/accounts/{accountId}/groups/{groupId}': {
      patch: {
        tags: ['Groups'], summary: 'Update a group subject or description', parameters: [accountParameter, groupParameter, idempotencyParameter],
        requestBody: jsonBody(object({ subject: { type: 'string' }, description: { type: 'string' } })),
        responses: { '200': commandResponse('Group update reached a terminal state'), '202': commandResponse('Update is queued'), '409': { description: 'Idempotency conflict' } },
      },
    },
    '/v1/accounts/{accountId}/groups/{groupId}/participants': {
      post: {
        tags: ['Groups'], summary: 'Add, remove, promote, or demote group participants', parameters: [accountParameter, groupParameter, idempotencyParameter],
        requestBody: jsonBody(object({ participants: { type: 'array', items: { type: 'string' }, minItems: 1 }, action: { type: 'string', enum: ['add', 'remove', 'promote', 'demote'], default: 'add' } }, ['participants'])),
        responses: { '200': commandResponse('Participant update reached a terminal state'), '202': commandResponse('Update is queued'), '409': { description: 'Idempotency conflict' } },
      },
    },
    '/v1/accounts/{accountId}/groups/{groupId}/participants/{participantId}': {
      delete: { tags: ['Groups'], summary: 'Remove one group participant', parameters: [accountParameter, groupParameter, pathParameter('participantId'), idempotencyParameter], responses: { '200': commandResponse('Removal reached a terminal state'), '202': commandResponse('Removal is queued'), '409': { description: 'Idempotency conflict' } } },
    },
    '/v1/webhook-endpoints': {
      get: { tags: ['Webhooks'], summary: 'List webhook endpoints', responses: { '200': { description: 'Endpoints' } } },
      post: {
        tags: ['Webhooks'], summary: 'Create a signed webhook endpoint',
        requestBody: jsonBody(object({
          url: { type: 'string', format: 'uri' }, description: { type: 'string' },
          event_types: { type: 'array', items: { type: 'string' }, default: [] },
          account_ids: { type: 'array', items: { type: 'string' }, default: [], description: 'Empty means every tenant connection; connection keys are forced to their assigned connection.' },
        }, ['url'])),
        responses: { '201': { description: 'Endpoint and one-time signing secret' } },
      },
    },
    '/v1/webhook-event-types': {
      get: { tags: ['Webhooks'], summary: 'List every subscribable normalized event type', responses: { '200': { description: 'Event type catalog' } } },
    },
    '/v1/webhook-endpoints/{endpointId}': {
      get: { tags: ['Webhooks'], summary: 'Get a webhook endpoint', parameters: [endpointParameter], responses: { '200': { description: 'Endpoint' }, '404': { description: 'Not found' } } },
      patch: {
        tags: ['Webhooks'], summary: 'Update URL, description, enabled state, or subscriptions', parameters: [endpointParameter],
        requestBody: jsonBody(object({
          url: { type: 'string', format: 'uri' }, description: { type: ['string', 'null'] }, enabled: { type: 'boolean' },
          event_types: { type: 'array', items: { type: 'string' } }, account_ids: { type: 'array', items: { type: 'string' } },
        })),
        responses: { '200': { description: 'Updated endpoint' }, '404': { description: 'Not found' } },
      },
      delete: { tags: ['Webhooks'], summary: 'Delete a webhook endpoint', parameters: [endpointParameter], responses: { '204': { description: 'Deleted' }, '404': { description: 'Not found' } } },
    },
    '/v1/webhook-deliveries': {
      get: { tags: ['Webhooks'], summary: 'Filter and paginate webhook deliveries', parameters: [
        { name: 'endpoint_id', in: 'query', schema: { type: 'string' } }, { name: 'account_id', in: 'query', schema: { type: 'string' } },
        { name: 'type', in: 'query', schema: { type: 'string' } }, { name: 'status', in: 'query', schema: { type: 'string' } },
        { name: 'before', in: 'query', schema: { type: 'string', format: 'date-time' } }, { name: 'limit', in: 'query', schema: { type: 'integer', minimum: 1, maximum: 500, default: 100 } },
      ], responses: { '200': { description: 'Deliveries and pagination cursor' } } },
    },
    '/v1/webhook-deliveries/{deliveryId}': {
      get: { tags: ['Webhooks'], summary: 'Inspect one webhook delivery and event', parameters: [deliveryParameter], responses: { '200': { description: 'Delivery details' }, '404': { description: 'Not found' } } },
    },
    '/v1/webhook-deliveries/{deliveryId}/replay': {
      post: { tags: ['Webhooks'], summary: 'Replay a webhook delivery', parameters: [deliveryParameter], responses: { '200': { description: 'Delivery reset to pending' }, '404': { description: 'Not found' } } },
    },
  },
};
