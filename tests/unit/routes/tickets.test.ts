import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { makeTicket } from '../../setup';

// ---------------------------------------------------------------------------
// Mocks
// ---------------------------------------------------------------------------

vi.mock('../../../src/services/ticketService', () => ({
  createTicket: vi.fn(),
  getTicket: vi.fn(),
  listTickets: vi.fn(),
  updateTicket: vi.fn(),
  resolveTicket: vi.fn(),
  getUserTickets: vi.fn(),
}));

vi.mock('../../../src/lib/prisma', () => ({ prisma: {} }));
vi.mock('../../../src/lib/events', () => ({
  publisher: { connect: vi.fn(), disconnect: vi.fn(), publish: vi.fn(), publishRaw: vi.fn() },
  consumer: { start: vi.fn(), stop: vi.fn(), on: vi.fn() },
  DisputeEvents: { created: vi.fn(), resolved: vi.fn() },
  SERVICE_NAME: 'dispute-service',
}));

// ---------------------------------------------------------------------------
import * as ticketService from '../../../src/services/ticketService';
import { buildApp } from '../../setup';

// ---------------------------------------------------------------------------
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

// ---------------------------------------------------------------------------
let app: FastifyInstance;

beforeEach(async () => {
  vi.clearAllMocks();
  app = await buildApp();
});

afterEach(async () => {
  await app.close();
});

// ---------------------------------------------------------------------------
describe('GET /tickets/mine', () => {
  it('returns own tickets for authenticated user', async () => {
    const tickets = [makeTicket({ userId: 'user-001' })];
    (ticketService.getUserTickets as ReturnType<typeof vi.fn>).mockResolvedValue(tickets);

    const res = await app.inject({
      method: 'GET',
      url: '/tickets/mine',
      headers: userHeaders(),
    });

    expect(res.statusCode).toBe(200);
    expect(res.json()).toHaveLength(1);
    expect(ticketService.getUserTickets).toHaveBeenCalledWith('user-001');
  });

  it('returns 401 when not authenticated', async () => {
    const res = await app.inject({ method: 'GET', url: '/tickets/mine' });
    expect(res.statusCode).toBe(401);
  });
});

// ---------------------------------------------------------------------------
describe('POST /tickets', () => {
  it('creates a ticket with valid body and returns 201', async () => {
    const ticket = makeTicket();
    (ticketService.createTicket as ReturnType<typeof vi.fn>).mockResolvedValue(ticket);

    const res = await app.inject({
      method: 'POST',
      url: '/tickets',
      headers: { ...userHeaders(), 'content-type': 'application/json' },
      payload: {
        subject: 'Payment issue',
        description: 'I was charged twice for the same campaign',
      },
    });

    expect(res.statusCode).toBe(201);
    expect(ticketService.createTicket).toHaveBeenCalledWith(
      'user-001',
      'Payment issue',
      'I was charged twice for the same campaign',
      expect.objectContaining({ userId: 'user-001' }),
      undefined
    );
  });

  it('creates a ticket with explicit priority', async () => {
    const ticket = makeTicket({ priority: 'URGENT' });
    (ticketService.createTicket as ReturnType<typeof vi.fn>).mockResolvedValue(ticket);

    const res = await app.inject({
      method: 'POST',
      url: '/tickets',
      headers: { ...userHeaders(), 'content-type': 'application/json' },
      payload: {
        subject: 'Critical issue',
        description: 'My account has been compromised and needs urgent attention',
        priority: 'URGENT',
      },
    });

    expect(res.statusCode).toBe(201);
    expect(ticketService.createTicket).toHaveBeenCalledWith(
      'user-001',
      'Critical issue',
      'My account has been compromised and needs urgent attention',
      expect.any(Object),
      'URGENT'
    );
  });

  it('returns 400 when subject is too short', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/tickets',
      headers: { ...userHeaders(), 'content-type': 'application/json' },
      payload: { subject: 'ab', description: 'description long enough to pass validation' },
    });

    expect(res.statusCode).toBe(400);
    expect(ticketService.createTicket).not.toHaveBeenCalled();
  });

  it('returns 400 when description is too short', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/tickets',
      headers: { ...userHeaders(), 'content-type': 'application/json' },
      payload: { subject: 'Valid subject', description: 'short' },
    });

    expect(res.statusCode).toBe(400);
  });

  it('returns 400 when priority value is invalid', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/tickets',
      headers: { ...userHeaders(), 'content-type': 'application/json' },
      payload: {
        subject: 'Valid subject',
        description: 'valid description long enough',
        priority: 'INVALID',
      },
    });

    expect(res.statusCode).toBe(400);
  });

  it('returns 401 when not authenticated', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/tickets',
      headers: { 'content-type': 'application/json' },
      payload: { subject: 'Valid subject', description: 'valid description here' },
    });

    expect(res.statusCode).toBe(401);
  });
});

// ---------------------------------------------------------------------------
describe('GET /tickets', () => {
  it('staff can list all tickets', async () => {
    (ticketService.listTickets as ReturnType<typeof vi.fn>).mockResolvedValue({
      tickets: [],
      total: 0,
      page: 1,
      limit: 20,
      totalPages: 0,
    });

    const res = await app.inject({
      method: 'GET',
      url: '/tickets',
      headers: staffHeaders(),
    });

    expect(res.statusCode).toBe(200);
    // Staff call: no userId filter
    expect(ticketService.listTickets).toHaveBeenCalledWith(
      expect.not.objectContaining({ userId: expect.anything() }),
      undefined,
      undefined
    );
  });

  it('non-staff users only see own tickets', async () => {
    (ticketService.listTickets as ReturnType<typeof vi.fn>).mockResolvedValue({
      tickets: [],
      total: 0,
      page: 1,
      limit: 20,
      totalPages: 0,
    });

    const res = await app.inject({
      method: 'GET',
      url: '/tickets',
      headers: userHeaders(),
    });

    expect(res.statusCode).toBe(200);
    expect(ticketService.listTickets).toHaveBeenCalledWith(
      expect.objectContaining({ userId: 'user-001' }),
      undefined,
      undefined
    );
  });

  it('passes status and priority filters to service', async () => {
    (ticketService.listTickets as ReturnType<typeof vi.fn>).mockResolvedValue({
      tickets: [],
      total: 0,
      page: 1,
      limit: 20,
      totalPages: 0,
    });

    await app.inject({
      method: 'GET',
      url: '/tickets?status=OPEN&priority=HIGH',
      headers: staffHeaders(),
    });

    expect(ticketService.listTickets).toHaveBeenCalledWith(
      expect.objectContaining({ status: 'OPEN', priority: 'HIGH' }),
      undefined,
      undefined
    );
  });

  it('returns 401 when not authenticated', async () => {
    const res = await app.inject({ method: 'GET', url: '/tickets' });
    expect(res.statusCode).toBe(401);
  });
});

// ---------------------------------------------------------------------------
describe('GET /tickets/:id', () => {
  it('returns ticket for owner', async () => {
    const ticket = makeTicket({ userId: 'user-001' });
    (ticketService.getTicket as ReturnType<typeof vi.fn>).mockResolvedValue(ticket);

    const res = await app.inject({
      method: 'GET',
      url: `/tickets/${ticket.id}`,
      headers: userHeaders(),
    });

    expect(res.statusCode).toBe(200);
    expect(res.json().id).toBe(ticket.id);
  });

  it('staff can view any ticket', async () => {
    const ticket = makeTicket({ userId: 'other-user' });
    (ticketService.getTicket as ReturnType<typeof vi.fn>).mockResolvedValue(ticket);

    const res = await app.inject({
      method: 'GET',
      url: `/tickets/${ticket.id}`,
      headers: staffHeaders(),
    });

    expect(res.statusCode).toBe(200);
  });

  it('returns 403 when non-staff tries to view another users ticket', async () => {
    const ticket = makeTicket({ userId: 'different-user-999' });
    (ticketService.getTicket as ReturnType<typeof vi.fn>).mockResolvedValue(ticket);

    const res = await app.inject({
      method: 'GET',
      url: `/tickets/${ticket.id}`,
      headers: userHeaders(), // user-001 is not different-user-999
    });

    expect(res.statusCode).toBe(403);
    expect(res.json().error.code).toBe('FORBIDDEN');
  });

  it('returns 404 when ticket does not exist', async () => {
    const { ServiceError } = await import('../../../src/lib/errors');
    (ticketService.getTicket as ReturnType<typeof vi.fn>).mockRejectedValue(
      new ServiceError(404, 'NOT_FOUND', 'Ticket nonexistent not found')
    );

    const res = await app.inject({
      method: 'GET',
      url: '/tickets/nonexistent',
      headers: userHeaders(),
    });

    expect(res.statusCode).toBe(404);
  });

  it('returns 401 when not authenticated', async () => {
    const res = await app.inject({ method: 'GET', url: '/tickets/some-id' });
    expect(res.statusCode).toBe(401);
  });
});

// ---------------------------------------------------------------------------
describe('PATCH /tickets/:id', () => {
  it('staff can update ticket status', async () => {
    const updated = makeTicket({ status: 'IN_PROGRESS' });
    (ticketService.updateTicket as ReturnType<typeof vi.fn>).mockResolvedValue(updated);

    const res = await app.inject({
      method: 'PATCH',
      url: `/tickets/${updated.id}`,
      headers: { ...staffHeaders(), 'content-type': 'application/json' },
      payload: { status: 'IN_PROGRESS' },
    });

    expect(res.statusCode).toBe(200);
    expect(ticketService.updateTicket).toHaveBeenCalledWith(
      updated.id,
      expect.objectContaining({ status: 'IN_PROGRESS' })
    );
  });

  it('staff can assign ticket', async () => {
    const updated = makeTicket({ assignedTo: 'staff-001' });
    (ticketService.updateTicket as ReturnType<typeof vi.fn>).mockResolvedValue(updated);

    const res = await app.inject({
      method: 'PATCH',
      url: `/tickets/${updated.id}`,
      headers: { ...staffHeaders(), 'content-type': 'application/json' },
      payload: { assignedTo: 'staff-001' },
    });

    expect(res.statusCode).toBe(200);
    expect(ticketService.updateTicket).toHaveBeenCalledWith(
      updated.id,
      expect.objectContaining({ assignedTo: 'staff-001' })
    );
  });

  it('returns 403 when non-staff tries to update', async () => {
    const res = await app.inject({
      method: 'PATCH',
      url: '/tickets/some-id',
      headers: { ...userHeaders(), 'content-type': 'application/json' },
      payload: { status: 'IN_PROGRESS' },
    });

    expect(res.statusCode).toBe(403);
    expect(ticketService.updateTicket).not.toHaveBeenCalled();
  });

  it('returns 400 when status value is invalid', async () => {
    const res = await app.inject({
      method: 'PATCH',
      url: '/tickets/some-id',
      headers: { ...staffHeaders(), 'content-type': 'application/json' },
      payload: { status: 'INVALID_STATUS' },
    });

    expect(res.statusCode).toBe(400);
  });

  it('returns 401 when not authenticated', async () => {
    const res = await app.inject({
      method: 'PATCH',
      url: '/tickets/some-id',
      headers: { 'content-type': 'application/json' },
      payload: { status: 'IN_PROGRESS' },
    });

    expect(res.statusCode).toBe(401);
  });
});

// ---------------------------------------------------------------------------
describe('PATCH /tickets/:id/resolve', () => {
  it('staff can resolve a ticket', async () => {
    const resolved = makeTicket({ status: 'RESOLVED', resolvedBy: 'staff-001' });
    (ticketService.resolveTicket as ReturnType<typeof vi.fn>).mockResolvedValue(resolved);

    const res = await app.inject({
      method: 'PATCH',
      url: `/tickets/${resolved.id}/resolve`,
      headers: { ...staffHeaders(), 'content-type': 'application/json' },
      payload: { transcript: 'Full conversation transcript here' },
    });

    expect(res.statusCode).toBe(200);
    expect(ticketService.resolveTicket).toHaveBeenCalledWith(
      resolved.id,
      'staff-001',
      'Full conversation transcript here'
    );
  });

  it('resolves without transcript', async () => {
    const resolved = makeTicket({ status: 'RESOLVED', resolvedBy: 'staff-001' });
    (ticketService.resolveTicket as ReturnType<typeof vi.fn>).mockResolvedValue(resolved);

    const res = await app.inject({
      method: 'PATCH',
      url: `/tickets/${resolved.id}/resolve`,
      headers: { ...staffHeaders(), 'content-type': 'application/json' },
      payload: {},
    });

    expect(res.statusCode).toBe(200);
    expect(ticketService.resolveTicket).toHaveBeenCalledWith(
      resolved.id,
      'staff-001',
      undefined
    );
  });

  it('returns 403 when non-staff tries to resolve', async () => {
    const res = await app.inject({
      method: 'PATCH',
      url: '/tickets/some-id/resolve',
      headers: { ...userHeaders(), 'content-type': 'application/json' },
      payload: {},
    });

    expect(res.statusCode).toBe(403);
    expect(ticketService.resolveTicket).not.toHaveBeenCalled();
  });

  it('returns 401 when not authenticated', async () => {
    const res = await app.inject({
      method: 'PATCH',
      url: '/tickets/some-id/resolve',
      headers: { 'content-type': 'application/json' },
      payload: {},
    });

    expect(res.statusCode).toBe(401);
  });

  it('returns 400 when ticket is already resolved', async () => {
    const { ServiceError } = await import('../../../src/lib/errors');
    (ticketService.resolveTicket as ReturnType<typeof vi.fn>).mockRejectedValue(
      new ServiceError(400, 'BAD_REQUEST', 'Ticket is already resolved or closed')
    );

    const res = await app.inject({
      method: 'PATCH',
      url: '/tickets/some-id/resolve',
      headers: { ...staffHeaders(), 'content-type': 'application/json' },
      payload: {},
    });

    expect(res.statusCode).toBe(400);
    expect(res.json().error.code).toBe('BAD_REQUEST');
  });
});
