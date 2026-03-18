import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { makeDispute } from '../setup';

// ---------------------------------------------------------------------------
// Mock all infrastructure — integration tests validate the full request path
// through routes -> services, with Prisma stubbed at the boundary.
// ---------------------------------------------------------------------------

vi.mock('../../src/lib/prisma', () => ({
  prisma: {
    clipDispute: {
      findFirst: vi.fn(),
      count: vi.fn(),
      create: vi.fn(),
      findUnique: vi.fn(),
      findMany: vi.fn(),
      update: vi.fn(),
    },
    supportTicket: {
      create: vi.fn(),
      findUnique: vi.fn(),
      findMany: vi.fn(),
      update: vi.fn(),
      count: vi.fn(),
    },
  },
}));

vi.mock('../../src/lib/events', () => ({
  publisher: { connect: vi.fn(), disconnect: vi.fn(), publish: vi.fn(), publishRaw: vi.fn() },
  consumer: { start: vi.fn(), stop: vi.fn(), on: vi.fn() },
  DisputeEvents: {
    created: vi.fn((payload, _svc) => ({ type: 'dispute.created', payload })),
    resolved: vi.fn((payload, _svc) => ({ type: 'dispute.resolved', payload })),
  },
  SERVICE_NAME: 'dispute-service',
}));

vi.mock('../../src/services/discordIntegration', () => ({
  createDisputeChannel: vi.fn().mockResolvedValue(null),
  createTicketChannel: vi.fn().mockResolvedValue(null),
  closeChannel: vi.fn().mockResolvedValue(true),
}));

// ---------------------------------------------------------------------------
import { buildApp } from '../setup';
import { prisma } from '../../src/lib/prisma';
import { publisher } from '../../src/lib/events';

type PrismaDisputeMock = {
  findFirst: ReturnType<typeof vi.fn>;
  count: ReturnType<typeof vi.fn>;
  create: ReturnType<typeof vi.fn>;
  findUnique: ReturnType<typeof vi.fn>;
  findMany: ReturnType<typeof vi.fn>;
  update: ReturnType<typeof vi.fn>;
};

const disputeMock = (prisma as any).clipDispute as PrismaDisputeMock;

function userHeaders(overrides: Record<string, string> = {}) {
  return {
    'x-user-id': 'user-001',
    'x-user-email': 'user@example.com',
    'x-user-name': 'Test User',
    'x-user-staff': 'false',
    ...overrides,
  };
}

function staffHeaders(overrides: Record<string, string> = {}) {
  return userHeaders({ 'x-user-id': 'staff-001', 'x-user-staff': 'true', ...overrides });
}

let app: FastifyInstance;

beforeEach(async () => {
  vi.clearAllMocks();
  app = await buildApp();
});

afterEach(async () => {
  await app.close();
});

// ---------------------------------------------------------------------------
describe('Dispute Creation Flow', () => {
  it('creates a dispute end-to-end and publishes event', async () => {
    const created = makeDispute({ userId: 'user-001', submissionId: 'sub-001' });

    disputeMock.findFirst.mockResolvedValue(null);
    disputeMock.count.mockResolvedValue(0);
    disputeMock.create.mockResolvedValue(created);
    (publisher.publish as ReturnType<typeof vi.fn>).mockResolvedValue(undefined);

    const res = await app.inject({
      method: 'POST',
      url: '/disputes',
      headers: { ...userHeaders(), 'content-type': 'application/json' },
      payload: {
        submissionId: 'sub-001',
        reason: 'This rejection was incorrect because the clip meets all requirements',
      },
    });

    expect(res.statusCode).toBe(201);
    const body = res.json();
    expect(body.id).toBe(created.id);
    expect(body.status).toBe('OPEN');

    // Verify event was published
    expect(publisher.publish).toHaveBeenCalledOnce();
    expect(publisher.publish).toHaveBeenCalledWith(
      expect.objectContaining({
        payload: expect.objectContaining({
          disputeId: created.id,
          clipId: 'sub-001',
          userId: 'user-001',
        }),
      })
    );
  });

  it('blocks creation when daily rate limit is reached', async () => {
    disputeMock.findFirst.mockResolvedValue(null);
    disputeMock.count.mockResolvedValue(3); // already at limit

    const res = await app.inject({
      method: 'POST',
      url: '/disputes',
      headers: { ...userHeaders(), 'content-type': 'application/json' },
      payload: {
        submissionId: 'sub-001',
        reason: 'This rejection was incorrect because the clip meets all requirements',
      },
    });

    expect(res.statusCode).toBe(429);
    expect(res.json().error.code).toBe('TOO_MANY_REQUESTS');
    expect(publisher.publish).not.toHaveBeenCalled();
  });

  it('blocks creation when cooldown window is active', async () => {
    disputeMock.findFirst.mockResolvedValue(makeDispute({ createdAt: new Date() }));

    const res = await app.inject({
      method: 'POST',
      url: '/disputes',
      headers: { ...userHeaders(), 'content-type': 'application/json' },
      payload: {
        submissionId: 'sub-001',
        reason: 'This rejection was incorrect because the clip meets all requirements',
      },
    });

    expect(res.statusCode).toBe(429);
    expect(publisher.publish).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
describe('Dispute Resolution Flow', () => {
  it('staff approves dispute and publishes resolved event', async () => {
    const openDispute = makeDispute({ status: 'OPEN', userId: 'user-001', discordChannelId: null });
    const approvedDispute = makeDispute({
      ...openDispute,
      status: 'APPROVED',
      resolvedBy: 'staff-001',
      resolvedAt: new Date(),
      staffNotes: 'Valid dispute',
    });

    disputeMock.findUnique.mockResolvedValue(openDispute);
    disputeMock.update.mockResolvedValue(approvedDispute);
    (publisher.publish as ReturnType<typeof vi.fn>).mockResolvedValue(undefined);

    const res = await app.inject({
      method: 'PATCH',
      url: `/disputes/${openDispute.id}/resolve`,
      headers: { ...staffHeaders(), 'content-type': 'application/json' },
      payload: { action: 'APPROVE', staffNotes: 'Valid dispute' },
    });

    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.status).toBe('APPROVED');

    // Resolved event published
    expect(publisher.publish).toHaveBeenCalledOnce();
    expect(publisher.publish).toHaveBeenCalledWith(
      expect.objectContaining({
        payload: expect.objectContaining({
          disputeId: openDispute.id,
          resolution: 'APPROVED',
          status: 'RESOLVED',
          resolvedBy: 'staff-001',
        }),
      })
    );
  });

  it('staff rejects dispute and publishes rejected event', async () => {
    const openDispute = makeDispute({ status: 'OPEN', discordChannelId: null });
    const rejectedDispute = makeDispute({ ...openDispute, status: 'REJECTED', resolvedBy: 'staff-001' });

    disputeMock.findUnique.mockResolvedValue(openDispute);
    disputeMock.update.mockResolvedValue(rejectedDispute);
    (publisher.publish as ReturnType<typeof vi.fn>).mockResolvedValue(undefined);

    const res = await app.inject({
      method: 'PATCH',
      url: `/disputes/${openDispute.id}/resolve`,
      headers: { ...staffHeaders(), 'content-type': 'application/json' },
      payload: { action: 'REJECT', staffNotes: 'Does not meet criteria' },
    });

    expect(res.statusCode).toBe(200);
    expect(publisher.publish).toHaveBeenCalledWith(
      expect.objectContaining({
        payload: expect.objectContaining({ resolution: 'REJECTED', status: 'REJECTED' }),
      })
    );
  });

  it('regular user cannot resolve disputes (403)', async () => {
    const res = await app.inject({
      method: 'PATCH',
      url: '/disputes/some-dispute-id/resolve',
      headers: { ...userHeaders(), 'content-type': 'application/json' },
      payload: { action: 'APPROVE' },
    });

    expect(res.statusCode).toBe(403);
    expect(publisher.publish).not.toHaveBeenCalled();
  });

  it('cannot resolve an already-approved dispute', async () => {
    const approvedDispute = makeDispute({ status: 'APPROVED' });
    disputeMock.findUnique.mockResolvedValue(approvedDispute);

    const res = await app.inject({
      method: 'PATCH',
      url: `/disputes/${approvedDispute.id}/resolve`,
      headers: { ...staffHeaders(), 'content-type': 'application/json' },
      payload: { action: 'REJECT' },
    });

    expect(res.statusCode).toBe(400);
    expect(res.json().error.code).toBe('BAD_REQUEST');
  });
});

// ---------------------------------------------------------------------------
describe('Dispute List and Visibility', () => {
  it('staff sees all disputes regardless of owner', async () => {
    const disputes = [
      makeDispute({ userId: 'user-001' }),
      makeDispute({ userId: 'user-002' }),
      makeDispute({ userId: 'user-003' }),
    ];
    disputeMock.findMany.mockResolvedValue(disputes);
    disputeMock.count.mockResolvedValue(3);

    const res = await app.inject({
      method: 'GET',
      url: '/disputes',
      headers: staffHeaders(),
    });

    expect(res.statusCode).toBe(200);
    expect(res.json().disputes).toHaveLength(3);
    // No userId filter in the where clause for staff
    expect(disputeMock.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: expect.not.objectContaining({ userId: expect.anything() }) })
    );
  });

  it('regular user only sees their own disputes', async () => {
    const myDisputes = [makeDispute({ userId: 'user-001' })];
    disputeMock.findMany.mockResolvedValue(myDisputes);
    disputeMock.count.mockResolvedValue(1);

    const res = await app.inject({
      method: 'GET',
      url: '/disputes',
      headers: userHeaders(),
    });

    expect(res.statusCode).toBe(200);
    // userId filter applied
    expect(disputeMock.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: expect.objectContaining({ userId: 'user-001' }) })
    );
  });

  it('user cannot directly access another users dispute by ID', async () => {
    const foreignDispute = makeDispute({ userId: 'another-user-999' });
    disputeMock.findUnique.mockResolvedValue(foreignDispute);

    const res = await app.inject({
      method: 'GET',
      url: `/disputes/${foreignDispute.id}`,
      headers: userHeaders(),
    });

    expect(res.statusCode).toBe(403);
  });
});
