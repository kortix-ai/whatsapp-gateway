import { isDeepStrictEqual } from 'node:util';
import { Prisma } from '@prisma/client';
import { prisma } from '../db/prisma.js';
import { id } from '../ids.js';

export class IdempotencyConflictError extends Error {}

type CommandRecord = {
  id: string;
  accountId: string;
  type: string;
  status: string;
  result: unknown;
  error: string | null;
  attemptCount: number;
  idempotencyKey: string | null;
  createdAt: Date;
  updatedAt: Date;
  completedAt: Date | null;
};

export function commandEnvelope(command: CommandRecord) {
  return {
    command_id: command.id,
    account_id: command.accountId,
    type: command.type,
    status: command.status,
    result: command.result,
    error: command.error,
    attempt_count: command.attemptCount,
    idempotency_key: command.idempotencyKey,
    created_at: command.createdAt,
    updated_at: command.updatedAt,
    completed_at: command.completedAt,
  };
}

function sameCommand(
  command: { accountId: string; type: string; payload: unknown },
  accountId: string,
  type: string,
  payload: unknown,
): boolean {
  return command.accountId === accountId && command.type === type && isDeepStrictEqual(command.payload, payload);
}

export async function enqueueCommand(
  tenantId: string,
  accountId: string,
  type: string,
  payload: unknown,
  idempotencyKey?: string,
) {
  if (idempotencyKey) {
    const existing = await prisma.outboundCommand.findUnique({
      where: { tenantId_idempotencyKey: { tenantId, idempotencyKey } },
      select: { id: true, accountId: true, type: true, payload: true },
    });
    if (existing) {
      if (!sameCommand(existing, accountId, type, payload)) {
        throw new IdempotencyConflictError('Idempotency-Key was already used for a different command');
      }
      return existing.id;
    }
  }
  const commandId = id('cmd');
  try {
    await prisma.outboundCommand.create({
      data: { id: commandId, tenantId, accountId, type, payload: payload as Prisma.InputJsonValue, ...(idempotencyKey ? { idempotencyKey } : {}) },
    });
  } catch (error) {
    if (idempotencyKey && error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
      const existing = await prisma.outboundCommand.findUniqueOrThrow({
        where: { tenantId_idempotencyKey: { tenantId, idempotencyKey } },
        select: { id: true, accountId: true, type: true, payload: true },
      });
      if (!sameCommand(existing, accountId, type, payload)) {
        throw new IdempotencyConflictError('Idempotency-Key was already used for a different command');
      }
      return existing.id;
    }
    throw error;
  }
  return commandId;
}

export async function waitForCommand(commandId: string, timeoutMs = 30_000) {
  const deadline = Date.now() + timeoutMs;
  while (true) {
    const command = await prisma.outboundCommand.findUnique({
      where: { id: commandId },
      select: {
        id: true,
        accountId: true,
        type: true,
        status: true,
        result: true,
        error: true,
        attemptCount: true,
        idempotencyKey: true,
        createdAt: true,
        updatedAt: true,
        completedAt: true,
      },
    });
    if (!command) throw new Error('Command not found');
    if (command.status === 'completed' || command.status === 'failed' || Date.now() >= deadline) {
      return commandEnvelope(command);
    }
    await new Promise((resolve) => setTimeout(resolve, 200));
  }
}
