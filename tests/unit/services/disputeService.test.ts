import { describe, it, expect, vi, beforeEach } from 'vitest';
import { makeDispute } from '../../setup';

// ---------------------------------------------------------------------------
// Module mocks — declared before any import of the module under test so that
// Vitest's hoisting can replace the real implementations.
// ---------------------------------------------------------------------------

vi.mock('../../../src/lib/prisma', () => ({
  prisma: {
    clipDispute: {
      findFirst: vi.fn(),
      count: vi.fn(),
      create: vi.fn(),
      findUnique: vi.fn(),
      findMany: vi.fn(),
      update: vi.fn(),
    },
  },
}));

vi.mock('../../../src/lib/events', () => ({
  publisher: { publish: vi.fn(), publishRaw: vi.fn() },
  DisputeEvents: {
    created: vi.fn((payload, _svc) => ({ type: 'dispute.created', payload })),
    resolved: vi.fn((payload, _svc) => ({ type: 'dispute.resolved', payload })),
  },
  SERVICE_NAME: 'dispute-service',
}));

vi.mock('../../../src/services/discordIntegration', () => ({
  createDisputeChannel: vi.fn().mockResolvedValue(null),
  closeChannel: vi.fn().mockResolvedValue(true),
}));

// ---------------------------------------------------------------------------
// Import SUT after mocks are wired up
// ---------------------------------------------------------------------------
import * as disputeService from '../../../src/services/disputeService';
import { prisma } from '../../../src/lib/prisma';
import { publisher, DisputeEvents } from '../../../src/lib/events';
import { createDisputeChannel, closeChannel } from '../../../src/services/discordIntegration';

const prismaMock = prisma as unknown as {
  clipDispute: {
    findFirst: ReturnType<typeof vi.fn>;
    count: ReturnType<typeof vi.fn>;
    create: ReturnType<typeof vi.fn>;
    findUnique: ReturnType<typeof vi.fn>;
    findMany: ReturnType<typeof vi.fn>;
    update: ReturnType<typeof vi.fn>;
  };
};

// Default AuthUser for tests
const mockUser = {
  userId: 'user-001',
  email: 'user@example.com',
  name: 'Test User',
  discordId: undefined as string | undefined,
  isStaff: false,
};

beforeEach(() => {
  vi.clearAllMocks();
});

// ---------------------------------------------------------------------------
describe('disputeService.createDispute', () => {
  it('creates a dispute when no recent disputes exist', async () => {
    const created = makeDispute();
    prismaMock.clipDispute.findFirst.mockResolvedValue(null);   // no cooldown hit
    prismaMock.clipDispute.count.mockResolvedValue(0);           // daily count = 0
    prismaMock.clipDispute.create.mockResolvedValue(created);
    (publisher.publish as ReturnType<typeof vi.fn>).mockResolvedValue(undefined);

    const result = await disputeService.createDispute(
      'user-001',
      'sub-001',
      'This rejection was incorrect because the clip meets all requirements',
      mockUser
    );

    expect(result).toEqual(created);
    expect(prismaMock.clipDispute.create).toHaveBeenCalledOnce();
    expect(publisher.publish).toHaveBeenCalledOnce();
    expect(DisputeEvents.created).toHaveBeenCalledWith(
      expect.objectContaining({ disputeId: created.id, clipId: 'sub-001', userId: 'user-001' }),
      'dispute-service'
    );
  });

  it('throws TOO_MANY_REQUESTS when within cooldown window', async () => {
    prismaMock.clipDispute.findFirst.mockResolvedValue(makeDispute()); // recent dispute exists

    await expect(
      disputeService.createDispute('user-001', 'sub-001', 'reason that is long enough', mockUser)
    ).rejects.toMatchObject({ statusCode: 429, code: 'TOO_MANY_REQUESTS' });

    expect(prismaMock.clipDispute.create).not.toHaveBeenCalled();
    expect(publisher.publish).not.toHaveBeenCalled();
  });

  it('throws TOO_MANY_REQUESTS when daily limit reached', async () => {
    prismaMock.clipDispute.findFirst.mockResolvedValue(null); // cooldown ok
    prismaMock.clipDispute.count.mockResolvedValue(3);        // daily limit hit

    await expect(
      disputeService.createDispute('user-001', 'sub-001', 'reason that is long enough', mockUser)
    ).rejects.toMatchObject({ statusCode: 429, code: 'TOO_MANY_REQUESTS' });

    expect(prismaMock.clipDispute.create).not.toHaveBeenCalled();
  });

  it('creates Discord channel when user has discordId and name', async () => {
    const created = makeDispute();
    const updatedWithChannel = makeDispute({ ...created, discordChannelId: 'ch-123' });
    prismaMock.clipDispute.findFirst.mockResolvedValue(null);
    prismaMock.clipDispute.count.mockResolvedValue(0);
    prismaMock.clipDispute.create.mockResolvedValue(created);
    prismaMock.clipDispute.update.mockResolvedValue(updatedWithChannel);
    (publisher.publish as ReturnType<typeof vi.fn>).mockResolvedValue(undefined);
    (createDisputeChannel as ReturnType<typeof vi.fn>).mockResolvedValue({
      channelId: 'ch-123',
      messageId: 'msg-456',
    });

    const userWithDiscord = { ...mockUser, discordId: 'discord-001', name: 'Test User' };
    await disputeService.createDispute('user-001', 'sub-001', 'reason that is long enough', userWithDiscord);

    expect(createDisputeChannel).toHaveBeenCalledWith(
      created.id,
      'discord-001',
      'Test User',
      'sub-001'
    );
    expect(prismaMock.clipDispute.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: created.id },
        data: expect.objectContaining({ discordChannelId: 'ch-123', discordMessageId: 'msg-456' }),
      })
    );
  });

  it('skips Discord channel creation when user has no discordId', async () => {
    const created = makeDispute();
    prismaMock.clipDispute.findFirst.mockResolvedValue(null);
    prismaMock.clipDispute.count.mockResolvedValue(0);
    prismaMock.clipDispute.create.mockResolvedValue(created);
    (publisher.publish as ReturnType<typeof vi.fn>).mockResolvedValue(undefined);

    await disputeService.createDispute('user-001', 'sub-001', 'reason that is long enough', mockUser);

    expect(createDisputeChannel).not.toHaveBeenCalled();
    expect(prismaMock.clipDispute.update).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
describe('disputeService.getDispute', () => {
  it('returns dispute when found', async () => {
    const dispute = makeDispute();
    prismaMock.clipDispute.findUnique.mockResolvedValue(dispute);

    const result = await disputeService.getDispute(dispute.id);
    expect(result).toEqual(dispute);
  });

  it('throws NOT_FOUND when dispute does not exist', async () => {
    prismaMock.clipDispute.findUnique.mockResolvedValue(null);

    await expect(disputeService.getDispute('nonexistent')).rejects.toMatchObject({
      statusCode: 404,
      code: 'NOT_FOUND',
    });
  });
});

// ---------------------------------------------------------------------------
describe('disputeService.listDisputes', () => {
  it('returns paginated disputes with defaults', async () => {
    const disputes = [makeDispute(), makeDispute()];
    prismaMock.clipDispute.findMany.mockResolvedValue(disputes);
    prismaMock.clipDispute.count.mockResolvedValue(2);

    const result = await disputeService.listDisputes();

    expect(result.disputes).toHaveLength(2);
    expect(result.total).toBe(2);
    expect(result.page).toBe(1);
    expect(result.limit).toBe(20);
    expect(result.totalPages).toBe(1);
  });

  it('filters by status when provided', async () => {
    prismaMock.clipDispute.findMany.mockResolvedValue([]);
    prismaMock.clipDispute.count.mockResolvedValue(0);

    await disputeService.listDisputes({ status: 'OPEN' });

    expect(prismaMock.clipDispute.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: expect.objectContaining({ status: 'OPEN' }) })
    );
  });

  it('filters by userId when provided', async () => {
    prismaMock.clipDispute.findMany.mockResolvedValue([]);
    prismaMock.clipDispute.count.mockResolvedValue(0);

    await disputeService.listDisputes({ userId: 'user-001' });

    expect(prismaMock.clipDispute.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: expect.objectContaining({ userId: 'user-001' }) })
    );
  });

  it('calculates correct pagination values', async () => {
    prismaMock.clipDispute.findMany.mockResolvedValue([]);
    prismaMock.clipDispute.count.mockResolvedValue(55);

    const result = await disputeService.listDisputes({}, 2, 20);

    expect(result.totalPages).toBe(3);
    expect(result.page).toBe(2);
    expect(prismaMock.clipDispute.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ skip: 20, take: 20 })
    );
  });
});

// ---------------------------------------------------------------------------
describe('disputeService.resolveDispute', () => {
  it('approves a dispute in OPEN status', async () => {
    const dispute = makeDispute({ status: 'OPEN', discordChannelId: null });
    const resolved = makeDispute({ ...dispute, status: 'APPROVED', resolvedBy: 'staff-001', resolvedAt: new Date() });
    prismaMock.clipDispute.findUnique.mockResolvedValue(dispute);
    prismaMock.clipDispute.update.mockResolvedValue(resolved);
    (publisher.publish as ReturnType<typeof vi.fn>).mockResolvedValue(undefined);

    const result = await disputeService.resolveDispute(dispute.id, 'staff-001', 'APPROVE', 'Looks valid');

    expect(result.status).toBe('APPROVED');
    expect(prismaMock.clipDispute.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: dispute.id },
        data: expect.objectContaining({ status: 'APPROVED', resolvedBy: 'staff-001', staffNotes: 'Looks valid' }),
      })
    );
    expect(DisputeEvents.resolved).toHaveBeenCalledWith(
      expect.objectContaining({ disputeId: dispute.id, resolution: 'APPROVED', status: 'RESOLVED' }),
      'dispute-service'
    );
    expect(publisher.publish).toHaveBeenCalledOnce();
  });

  it('rejects a dispute in UNDER_REVIEW status', async () => {
    const dispute = makeDispute({ status: 'UNDER_REVIEW', discordChannelId: null });
    const rejected = makeDispute({ ...dispute, status: 'REJECTED', resolvedBy: 'staff-001' });
    prismaMock.clipDispute.findUnique.mockResolvedValue(dispute);
    prismaMock.clipDispute.update.mockResolvedValue(rejected);
    (publisher.publish as ReturnType<typeof vi.fn>).mockResolvedValue(undefined);

    const result = await disputeService.resolveDispute(dispute.id, 'staff-001', 'REJECT');

    expect(result.status).toBe('REJECTED');
    expect(DisputeEvents.resolved).toHaveBeenCalledWith(
      expect.objectContaining({ resolution: 'REJECTED', status: 'REJECTED' }),
      'dispute-service'
    );
  });

  it('throws BAD_REQUEST when dispute is already resolved', async () => {
    const dispute = makeDispute({ status: 'APPROVED' });
    prismaMock.clipDispute.findUnique.mockResolvedValue(dispute);

    await expect(
      disputeService.resolveDispute(dispute.id, 'staff-001', 'APPROVE')
    ).rejects.toMatchObject({ statusCode: 400, code: 'BAD_REQUEST' });

    expect(prismaMock.clipDispute.update).not.toHaveBeenCalled();
  });

  it('throws BAD_REQUEST when dispute is CLOSED', async () => {
    const dispute = makeDispute({ status: 'CLOSED' });
    prismaMock.clipDispute.findUnique.mockResolvedValue(dispute);

    await expect(
      disputeService.resolveDispute(dispute.id, 'staff-001', 'REJECT')
    ).rejects.toMatchObject({ statusCode: 400, code: 'BAD_REQUEST' });
  });

  it('closes the Discord channel on resolution when channelId exists', async () => {
    const dispute = makeDispute({ status: 'OPEN', discordChannelId: 'ch-999' });
    const resolved = makeDispute({ ...dispute, status: 'APPROVED' });
    prismaMock.clipDispute.findUnique.mockResolvedValue(dispute);
    prismaMock.clipDispute.update.mockResolvedValue(resolved);
    (publisher.publish as ReturnType<typeof vi.fn>).mockResolvedValue(undefined);

    await disputeService.resolveDispute(dispute.id, 'staff-001', 'APPROVE');

    expect(closeChannel).toHaveBeenCalledWith('ch-999');
  });

  it('skips channel close when no discordChannelId', async () => {
    const dispute = makeDispute({ status: 'OPEN', discordChannelId: null });
    const resolved = makeDispute({ ...dispute, status: 'APPROVED' });
    prismaMock.clipDispute.findUnique.mockResolvedValue(dispute);
    prismaMock.clipDispute.update.mockResolvedValue(resolved);
    (publisher.publish as ReturnType<typeof vi.fn>).mockResolvedValue(undefined);

    await disputeService.resolveDispute(dispute.id, 'staff-001', 'APPROVE');

    expect(closeChannel).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
describe('disputeService.getUserDisputes', () => {
  it('returns disputes for a specific user ordered by createdAt desc', async () => {
    const disputes = [makeDispute({ userId: 'user-001' }), makeDispute({ userId: 'user-001' })];
    prismaMock.clipDispute.findMany.mockResolvedValue(disputes);

    const result = await disputeService.getUserDisputes('user-001');

    expect(result).toHaveLength(2);
    expect(prismaMock.clipDispute.findMany).toHaveBeenCalledWith({
      where: { userId: 'user-001' },
      orderBy: { createdAt: 'desc' },
    });
  });

  it('returns empty array when user has no disputes', async () => {
    prismaMock.clipDispute.findMany.mockResolvedValue([]);

    const result = await disputeService.getUserDisputes('user-no-disputes');
    expect(result).toHaveLength(0);
  });
});
