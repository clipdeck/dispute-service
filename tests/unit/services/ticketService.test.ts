import { describe, it, expect, vi, beforeEach } from 'vitest';
import { makeTicket } from '../../setup';

// ---------------------------------------------------------------------------
// Module mocks
// ---------------------------------------------------------------------------

vi.mock('../../../src/lib/prisma', () => ({
  prisma: {
    supportTicket: {
      create: vi.fn(),
      findUnique: vi.fn(),
      findMany: vi.fn(),
      update: vi.fn(),
      count: vi.fn(),
    },
  },
}));

vi.mock('../../../src/lib/events', () => ({
  publisher: { publish: vi.fn(), publishRaw: vi.fn() },
  DisputeEvents: {
    created: vi.fn(),
    resolved: vi.fn(),
  },
  SERVICE_NAME: 'dispute-service',
}));

vi.mock('../../../src/services/discordIntegration', () => ({
  createTicketChannel: vi.fn().mockResolvedValue(null),
  createDisputeChannel: vi.fn().mockResolvedValue(null),
  closeChannel: vi.fn().mockResolvedValue(true),
}));

// ---------------------------------------------------------------------------
import * as ticketService from '../../../src/services/ticketService';
import { prisma } from '../../../src/lib/prisma';
import { publisher } from '../../../src/lib/events';
import { createTicketChannel, closeChannel } from '../../../src/services/discordIntegration';

const prismaMock = prisma as unknown as {
  supportTicket: {
    create: ReturnType<typeof vi.fn>;
    findUnique: ReturnType<typeof vi.fn>;
    findMany: ReturnType<typeof vi.fn>;
    update: ReturnType<typeof vi.fn>;
    count: ReturnType<typeof vi.fn>;
  };
};

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
describe('ticketService.createTicket', () => {
  it('creates a ticket with default MEDIUM priority', async () => {
    const ticket = makeTicket({ priority: 'MEDIUM' });
    prismaMock.supportTicket.create.mockResolvedValue(ticket);
    (publisher.publishRaw as ReturnType<typeof vi.fn>).mockResolvedValue(undefined);

    const result = await ticketService.createTicket(
      'user-001',
      'Test subject',
      'Test description with enough characters',
      mockUser
    );

    expect(result).toEqual(ticket);
    expect(prismaMock.supportTicket.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ priority: 'MEDIUM', status: 'OPEN' }),
      })
    );
    expect(publisher.publishRaw).toHaveBeenCalledWith(
      'ticket.created',
      expect.objectContaining({ ticketId: ticket.id, userId: 'user-001' })
    );
  });

  it('creates a ticket with explicit priority', async () => {
    const ticket = makeTicket({ priority: 'URGENT' });
    prismaMock.supportTicket.create.mockResolvedValue(ticket);
    (publisher.publishRaw as ReturnType<typeof vi.fn>).mockResolvedValue(undefined);

    await ticketService.createTicket('user-001', 'Test subject', 'Test description with enough', mockUser, 'URGENT');

    expect(prismaMock.supportTicket.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ priority: 'URGENT' }),
      })
    );
  });

  it('publishes ticket.created event after creation', async () => {
    const ticket = makeTicket({ subject: 'Payment problem' });
    prismaMock.supportTicket.create.mockResolvedValue(ticket);
    (publisher.publishRaw as ReturnType<typeof vi.fn>).mockResolvedValue(undefined);

    await ticketService.createTicket('user-001', 'Payment problem', 'description long enough', mockUser);

    expect(publisher.publishRaw).toHaveBeenCalledOnce();
    expect(publisher.publishRaw).toHaveBeenCalledWith(
      'ticket.created',
      expect.objectContaining({ ticketId: ticket.id, subject: 'Payment problem', userId: 'user-001' })
    );
  });

  it('creates Discord channel when user has discordId and name', async () => {
    const ticket = makeTicket();
    const updatedTicket = makeTicket({ ...ticket, discordChannelId: 'ch-ticket-123' });
    prismaMock.supportTicket.create.mockResolvedValue(ticket);
    prismaMock.supportTicket.update.mockResolvedValue(updatedTicket);
    (publisher.publishRaw as ReturnType<typeof vi.fn>).mockResolvedValue(undefined);
    (createTicketChannel as ReturnType<typeof vi.fn>).mockResolvedValue({
      channelId: 'ch-ticket-123',
      messageId: 'msg-789',
    });

    const userWithDiscord = { ...mockUser, discordId: 'discord-111', name: 'Test User' };
    await ticketService.createTicket('user-001', 'Test subject', 'description', userWithDiscord);

    expect(createTicketChannel).toHaveBeenCalledWith(
      ticket.id,
      'discord-111',
      'Test User',
      ticket.subject
    );
    expect(prismaMock.supportTicket.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: ticket.id },
        data: expect.objectContaining({ discordChannelId: 'ch-ticket-123', discordMessageId: 'msg-789' }),
      })
    );
  });

  it('skips Discord channel creation when user has no discordId', async () => {
    const ticket = makeTicket();
    prismaMock.supportTicket.create.mockResolvedValue(ticket);
    (publisher.publishRaw as ReturnType<typeof vi.fn>).mockResolvedValue(undefined);

    await ticketService.createTicket('user-001', 'subject', 'description', mockUser);

    expect(createTicketChannel).not.toHaveBeenCalled();
    expect(prismaMock.supportTicket.update).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
describe('ticketService.getTicket', () => {
  it('returns the ticket when found', async () => {
    const ticket = makeTicket();
    prismaMock.supportTicket.findUnique.mockResolvedValue(ticket);

    const result = await ticketService.getTicket(ticket.id);
    expect(result).toEqual(ticket);
  });

  it('throws NOT_FOUND when ticket does not exist', async () => {
    prismaMock.supportTicket.findUnique.mockResolvedValue(null);

    await expect(ticketService.getTicket('nonexistent')).rejects.toMatchObject({
      statusCode: 404,
      code: 'NOT_FOUND',
    });
  });
});

// ---------------------------------------------------------------------------
describe('ticketService.listTickets', () => {
  it('returns paginated tickets with defaults', async () => {
    const tickets = [makeTicket(), makeTicket()];
    prismaMock.supportTicket.findMany.mockResolvedValue(tickets);
    prismaMock.supportTicket.count.mockResolvedValue(2);

    const result = await ticketService.listTickets();

    expect(result.tickets).toHaveLength(2);
    expect(result.total).toBe(2);
    expect(result.page).toBe(1);
    expect(result.limit).toBe(20);
    expect(result.totalPages).toBe(1);
  });

  it('filters by status', async () => {
    prismaMock.supportTicket.findMany.mockResolvedValue([]);
    prismaMock.supportTicket.count.mockResolvedValue(0);

    await ticketService.listTickets({ status: 'OPEN' });

    expect(prismaMock.supportTicket.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: expect.objectContaining({ status: 'OPEN' }) })
    );
  });

  it('filters by priority', async () => {
    prismaMock.supportTicket.findMany.mockResolvedValue([]);
    prismaMock.supportTicket.count.mockResolvedValue(0);

    await ticketService.listTickets({ priority: 'HIGH' });

    expect(prismaMock.supportTicket.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: expect.objectContaining({ priority: 'HIGH' }) })
    );
  });

  it('filters by userId for non-staff access scoping', async () => {
    prismaMock.supportTicket.findMany.mockResolvedValue([]);
    prismaMock.supportTicket.count.mockResolvedValue(0);

    await ticketService.listTickets({ userId: 'user-001' });

    expect(prismaMock.supportTicket.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: expect.objectContaining({ userId: 'user-001' }) })
    );
  });

  it('filters by assignedTo', async () => {
    prismaMock.supportTicket.findMany.mockResolvedValue([]);
    prismaMock.supportTicket.count.mockResolvedValue(0);

    await ticketService.listTickets({ assignedTo: 'staff-001' });

    expect(prismaMock.supportTicket.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: expect.objectContaining({ assignedTo: 'staff-001' }) })
    );
  });

  it('applies correct skip for page 3 with limit 10', async () => {
    prismaMock.supportTicket.findMany.mockResolvedValue([]);
    prismaMock.supportTicket.count.mockResolvedValue(30);

    const result = await ticketService.listTickets({}, 3, 10);

    expect(prismaMock.supportTicket.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ skip: 20, take: 10 })
    );
    expect(result.totalPages).toBe(3);
  });
});

// ---------------------------------------------------------------------------
describe('ticketService.updateTicket', () => {
  it('updates ticket status', async () => {
    const ticket = makeTicket({ status: 'OPEN' });
    const updated = makeTicket({ ...ticket, status: 'IN_PROGRESS' });
    prismaMock.supportTicket.findUnique.mockResolvedValue(ticket);
    prismaMock.supportTicket.update.mockResolvedValue(updated);

    const result = await ticketService.updateTicket(ticket.id, { status: 'IN_PROGRESS' });

    expect(result.status).toBe('IN_PROGRESS');
    expect(prismaMock.supportTicket.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: ticket.id },
        data: expect.objectContaining({ status: 'IN_PROGRESS' }),
      })
    );
  });

  it('assigns ticket to staff member', async () => {
    const ticket = makeTicket({ assignedTo: null });
    const updated = makeTicket({ ...ticket, assignedTo: 'staff-001' });
    prismaMock.supportTicket.findUnique.mockResolvedValue(ticket);
    prismaMock.supportTicket.update.mockResolvedValue(updated);

    const result = await ticketService.updateTicket(ticket.id, { assignedTo: 'staff-001' });

    expect(result.assignedTo).toBe('staff-001');
  });

  it('updates priority', async () => {
    const ticket = makeTicket({ priority: 'LOW' });
    const updated = makeTicket({ ...ticket, priority: 'URGENT' });
    prismaMock.supportTicket.findUnique.mockResolvedValue(ticket);
    prismaMock.supportTicket.update.mockResolvedValue(updated);

    await ticketService.updateTicket(ticket.id, { priority: 'URGENT' });

    expect(prismaMock.supportTicket.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ priority: 'URGENT' }),
      })
    );
  });

  it('throws NOT_FOUND when ticket does not exist', async () => {
    prismaMock.supportTicket.findUnique.mockResolvedValue(null);

    await expect(
      ticketService.updateTicket('nonexistent', { status: 'IN_PROGRESS' })
    ).rejects.toMatchObject({ statusCode: 404 });
  });
});

// ---------------------------------------------------------------------------
describe('ticketService.resolveTicket', () => {
  it('resolves an OPEN ticket', async () => {
    const ticket = makeTicket({ status: 'OPEN', discordChannelId: null });
    const resolved = makeTicket({ ...ticket, status: 'RESOLVED', resolvedBy: 'staff-001', resolvedAt: new Date() });
    prismaMock.supportTicket.findUnique.mockResolvedValue(ticket);
    prismaMock.supportTicket.update.mockResolvedValue(resolved);
    (publisher.publishRaw as ReturnType<typeof vi.fn>).mockResolvedValue(undefined);

    const result = await ticketService.resolveTicket(ticket.id, 'staff-001', 'conversation transcript');

    expect(result.status).toBe('RESOLVED');
    expect(prismaMock.supportTicket.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          status: 'RESOLVED',
          resolvedBy: 'staff-001',
          transcript: 'conversation transcript',
        }),
      })
    );
    expect(publisher.publishRaw).toHaveBeenCalledWith(
      'ticket.resolved',
      expect.objectContaining({ ticketId: ticket.id, resolvedBy: 'staff-001' })
    );
  });

  it('resolves an IN_PROGRESS ticket', async () => {
    const ticket = makeTicket({ status: 'IN_PROGRESS', discordChannelId: null });
    const resolved = makeTicket({ ...ticket, status: 'RESOLVED' });
    prismaMock.supportTicket.findUnique.mockResolvedValue(ticket);
    prismaMock.supportTicket.update.mockResolvedValue(resolved);
    (publisher.publishRaw as ReturnType<typeof vi.fn>).mockResolvedValue(undefined);

    const result = await ticketService.resolveTicket(ticket.id, 'staff-001');
    expect(result.status).toBe('RESOLVED');
  });

  it('throws BAD_REQUEST when ticket is already RESOLVED', async () => {
    const ticket = makeTicket({ status: 'RESOLVED' });
    prismaMock.supportTicket.findUnique.mockResolvedValue(ticket);

    await expect(
      ticketService.resolveTicket(ticket.id, 'staff-001')
    ).rejects.toMatchObject({ statusCode: 400, code: 'BAD_REQUEST' });

    expect(prismaMock.supportTicket.update).not.toHaveBeenCalled();
  });

  it('throws BAD_REQUEST when ticket is already CLOSED', async () => {
    const ticket = makeTicket({ status: 'CLOSED' });
    prismaMock.supportTicket.findUnique.mockResolvedValue(ticket);

    await expect(
      ticketService.resolveTicket(ticket.id, 'staff-001')
    ).rejects.toMatchObject({ statusCode: 400, code: 'BAD_REQUEST' });
  });

  it('closes Discord channel on resolution when channelId exists', async () => {
    const ticket = makeTicket({ status: 'OPEN', discordChannelId: 'ch-ticket-456' });
    const resolved = makeTicket({ ...ticket, status: 'RESOLVED' });
    prismaMock.supportTicket.findUnique.mockResolvedValue(ticket);
    prismaMock.supportTicket.update.mockResolvedValue(resolved);
    (publisher.publishRaw as ReturnType<typeof vi.fn>).mockResolvedValue(undefined);

    await ticketService.resolveTicket(ticket.id, 'staff-001');

    expect(closeChannel).toHaveBeenCalledWith('ch-ticket-456');
  });

  it('skips Discord channel close when no channelId', async () => {
    const ticket = makeTicket({ status: 'IN_PROGRESS', discordChannelId: null });
    const resolved = makeTicket({ ...ticket, status: 'RESOLVED' });
    prismaMock.supportTicket.findUnique.mockResolvedValue(ticket);
    prismaMock.supportTicket.update.mockResolvedValue(resolved);
    (publisher.publishRaw as ReturnType<typeof vi.fn>).mockResolvedValue(undefined);

    await ticketService.resolveTicket(ticket.id, 'staff-001');

    expect(closeChannel).not.toHaveBeenCalled();
  });

  it('resolves without transcript when none provided', async () => {
    const ticket = makeTicket({ status: 'OPEN', discordChannelId: null });
    const resolved = makeTicket({ ...ticket, status: 'RESOLVED', transcript: null });
    prismaMock.supportTicket.findUnique.mockResolvedValue(ticket);
    prismaMock.supportTicket.update.mockResolvedValue(resolved);
    (publisher.publishRaw as ReturnType<typeof vi.fn>).mockResolvedValue(undefined);

    await ticketService.resolveTicket(ticket.id, 'staff-001');

    expect(prismaMock.supportTicket.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ transcript: null }),
      })
    );
  });
});

// ---------------------------------------------------------------------------
describe('ticketService.getUserTickets', () => {
  it('returns tickets for a specific user ordered by createdAt desc', async () => {
    const tickets = [makeTicket({ userId: 'user-001' }), makeTicket({ userId: 'user-001' })];
    prismaMock.supportTicket.findMany.mockResolvedValue(tickets);

    const result = await ticketService.getUserTickets('user-001');

    expect(result).toHaveLength(2);
    expect(prismaMock.supportTicket.findMany).toHaveBeenCalledWith({
      where: { userId: 'user-001' },
      orderBy: { createdAt: 'desc' },
    });
  });

  it('returns empty array when user has no tickets', async () => {
    prismaMock.supportTicket.findMany.mockResolvedValue([]);

    const result = await ticketService.getUserTickets('user-no-tickets');
    expect(result).toHaveLength(0);
  });
});
