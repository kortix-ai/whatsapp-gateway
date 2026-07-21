import { prisma } from '../db/prisma.js';

const BASE_DELAY_MS = 1_000;
const MAX_DELAY_MS = 5 * 60_000;

export function reconnectDelayMs(attempt: number, random = Math.random): number {
  const exponential = Math.min(MAX_DELAY_MS, BASE_DELAY_MS * 2 ** Math.min(Math.max(attempt - 1, 0), 18));
  const jitter = Math.floor(random() * Math.max(250, exponential * 0.2));
  return exponential + jitter;
}

export async function scheduleReconnect(accountId: string, error: string): Promise<{ attempt: number; nextConnectAt: Date }> {
  return prisma.$transaction(async (tx) => {
    const account = await tx.whatsAppAccount.findUniqueOrThrow({
      where: { id: accountId },
      select: { reconnectAttempt: true },
    });
    const attempt = account.reconnectAttempt + 1;
    const nextConnectAt = new Date(Date.now() + reconnectDelayMs(attempt));
    await tx.whatsAppAccount.update({
      where: { id: accountId },
      data: { status: 'reconnecting', reconnectAttempt: attempt, nextConnectAt, lastError: error },
    });
    return { attempt, nextConnectAt };
  });
}

export async function resetReconnectBackoff(accountId: string): Promise<void> {
  await prisma.whatsAppAccount.updateMany({
    where: { id: accountId, status: 'connected' },
    data: { reconnectAttempt: 0, nextConnectAt: null },
  });
}
