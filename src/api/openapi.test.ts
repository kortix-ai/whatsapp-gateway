import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { openApiDocument } from './openapi.js';

describe('OpenAPI document', () => {
  it('documents every explicit Hono REST route and method', () => {
    const source = readFileSync(fileURLToPath(new URL('./app.ts', import.meta.url)), 'utf8');
    const routes = [...source.matchAll(/app\.(get|post|patch|delete)\('([^']+)'/g)]
      .map((match) => ({ method: match[1], path: match[2]?.replace(/:([A-Za-z]+)/g, '{$1}') }))
      .filter((route): route is { method: string; path: string } => Boolean(route.method && route.path));
    for (const route of routes) {
      const path = openApiDocument.paths[route.path as keyof typeof openApiDocument.paths] as Record<string, unknown> | undefined;
      expect(path, `missing path ${route.path}`).toBeDefined();
      expect(path?.[route.method], `missing ${route.method.toUpperCase()} ${route.path}`).toBeDefined();
    }
  });

  it('documents the real durable command body and idempotency contract', () => {
    const action = openApiDocument.paths['/v1/accounts/{accountId}/actions/{action}'].post;
    expect(action.parameters.some((parameter) => parameter.name === 'Idempotency-Key' && parameter.in === 'header')).toBe(true);
    expect(action.responses['200'].content['application/json'].schema).toEqual({ $ref: '#/components/schemas/CommandEnvelope' });
    expect(openApiDocument.components.schemas.CommandEnvelope.properties).toHaveProperty('command_id');
    expect(openApiDocument.components.schemas.CommandEnvelope.properties).toHaveProperty('status');
    expect(openApiDocument.components.schemas.CommandEnvelope.properties).toHaveProperty('result');
  });
});
