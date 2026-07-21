import type { Prisma } from '@prisma/client';
import { prisma } from '../db/prisma.js';
import { id } from '../ids.js';

export async function enqueueCommand(tenantId: string, accountId: string, type: string, payload: unknown) {
  const commandId = id('cmd');
  await prisma.outboundCommand.create({
    data: { id: commandId, tenantId, accountId, type, payload: payload as Prisma.InputJsonValue },
  });
  return commandId;
}

export async function waitForCommand(commandId: string, timeoutMs = 30_000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const command = await prisma.outboundCommand.findUnique({
      where: { id: commandId },
      select: { status: true, result: true, error: true },
    });
    if (!command) throw new Error('Command not found');
    if (command.status === 'completed') return command.result;
    if (command.status === 'failed') throw new Error(command.error || 'Command failed');
    await new Promise((resolve) => setTimeout(resolve, 200));
  }
  return { command_id: commandId, status: 'pending' };
}
