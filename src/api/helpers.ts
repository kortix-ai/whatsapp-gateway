import { HTTPException } from 'hono/http-exception';
import type { Context } from 'hono';
import type { z } from 'zod';
import type { GatewayVariables } from '../auth/middleware.js';
import { prisma } from '../db/prisma.js';
import { enqueueCommand, waitForCommand } from '../services/commands.js';

export async function body<T extends z.ZodType>(context: { req: { json: () => Promise<unknown> } }, schema: T): Promise<z.infer<T>> {
  const parsed = schema.safeParse(await context.req.json());
  if (!parsed.success) throw new HTTPException(400, { message: parsed.error.issues.map((issue) => issue.message).join(', ') });
  return parsed.data;
}

export async function accountFor(actor: GatewayVariables['actor'], accountId: string) {
  if (actor.accountIds && !actor.accountIds.includes(accountId)) throw new HTTPException(404, { message: 'Account not found' });
  const account = await prisma.whatsAppAccount.findFirst({ where: { id: accountId, tenantId: actor.tenantId } });
  if (!account) throw new HTTPException(404, { message: 'Account not found' });
  return account;
}

export function hasPermission(actor: GatewayVariables['actor'], resource: string, action: string): boolean {
  if (actor.type === 'user' || actor.permissions === null) return true;
  const granted = actor.permissions[resource] ?? [];
  return granted.includes(action) || granted.includes('*');
}

export function idempotencyKey(context: { req: { header: (name: string) => string | undefined } }): string | undefined {
  const value = context.req.header('Idempotency-Key')?.trim();
  if (value && value.length > 200) throw new HTTPException(400, { message: 'Idempotency-Key must be 200 characters or fewer' });
  return value || undefined;
}

export function dateQuery(value: string | undefined, name: string): Date | undefined {
  if (!value) return undefined;
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) throw new HTTPException(400, { message: `${name} must be an ISO-8601 timestamp` });
  return parsed;
}

export function limitQuery(value: string | undefined, fallback: number, max: number): number {
  const parsed = Number(value ?? fallback);
  return Number.isNaN(parsed) ? fallback : Math.min(Math.max(parsed, 1), max);
}

export function commandStatus(result: { status: string }): 200 | 202 {
  return result.status === 'pending' || result.status === 'processing' ? 202 : 200;
}

/** Enqueue a durable command, wait for its result, and answer 200 (terminal) or 202 (still pending). */
export async function dispatchCommand(
  context: Context<{ Variables: GatewayVariables }>,
  account: { id: string; tenantId: string },
  type: string,
  payload: unknown,
  timeoutMs = 30_000,
) {
  const commandId = await enqueueCommand(account.tenantId, account.id, type, payload, idempotencyKey(context));
  const result = await waitForCommand(commandId, timeoutMs);
  return context.json(result, commandStatus(result));
}
