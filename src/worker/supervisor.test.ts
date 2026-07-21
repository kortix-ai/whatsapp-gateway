import { beforeEach, describe, expect, it, vi } from 'vitest';

const { findMany } = vi.hoisted(() => ({ findMany: vi.fn() }));

vi.mock('../db/prisma.js', () => ({
  prisma: { whatsAppAccount: { findMany } },
}));
vi.mock('../baileys/session.js', () => ({
  BaileysSession: class {},
}));
vi.mock('./leases.js', () => ({
  acquireLease: vi.fn(), heartbeatLease: vi.fn(), releaseLease: vi.fn(),
}));
vi.mock('./reconnect.js', () => ({ scheduleReconnect: vi.fn() }));

import { SessionSupervisor } from './supervisor.js';

describe('SessionSupervisor scheduling', () => {
  beforeEach(() => findMany.mockReset());

  it('does not overlap database polls', async () => {
    let resolveFirst: (value: []) => void = () => undefined;
    findMany.mockReturnValueOnce(new Promise<[]>((resolve) => { resolveFirst = resolve; }));
    const supervisor = new SessionSupervisor();
    const poll = (supervisor as unknown as { poll: () => Promise<void> }).poll.bind(supervisor);

    const first = poll();
    const second = poll();
    expect(findMany).toHaveBeenCalledTimes(1);
    resolveFirst([]);
    await Promise.all([first, second]);
  });
});
