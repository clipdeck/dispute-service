import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { makeDispute } from '../../setup';

// ---------------------------------------------------------------------------
// Mock services before importing the app
// ---------------------------------------------------------------------------

vi.mock('../../../src/services/disputeService', () => ({
  createDispute: vi.fn(),
  getDispute: vi.fn(),
  listDisputes: vi.fn(),
  resolveDispute: vi.fn(),
  getUserDisputes: vi.fn(),
}));

vi.mock('../../../src/lib/prisma', () => ({ prisma: {} }));
vi.mock('../../../src/lib/events', () => ({
  publisher: { connect: vi.fn(), disconnect: vi.fn(), publish: vi.fn(), publishRaw: vi.fn() },
  consumer: { start: vi.fn(), stop: vi.fn(), on: vi.fn() },
  DisputeEvents: { created: vi.fn(), resolved: vi.fn() },
  SERVICE_NAME: 'dispute-service',
}));

// ---------------------------------------------------------------------------
import * as disputeService from '../../../src/services/disputeService';
import { buildApp } from '../../setup';

// ---------------------------------------------------------------------------
// Helpers
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
describe('GET /disputes/mine', () => {
  it('returns own disputes for authenticated user', async () => {
    const disputes = [makeDispute({ userId: 'user-001' })];
    (disputeService.getUserDisputes as ReturnType<typeof vi.fn>).mockResolvedValue(disputes);

    const res = await app.inject({
      method: 'GET',
      url: '/disputes/mine',
      headers: userHeaders(),
    });

    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body).toHaveLength(1);
    expect(disputeService.getUserDisputes).toHaveBeenCalledWith('user-001');
  });

  it('returns 401 when not authenticated', async () => {
    const res = await app.inject({ method: 'GET', url: '/disputes/mine' });
    expect(res.statusCode).toBe(401);
  });
});

// ---------------------------------------------------------------------------
describe('POST /disputes', () => {
  it('creates a dispute with valid body and returns 201', async () => {
    const dispute = makeDispute();
    (disputeService.createDispute as ReturnType<typeof vi.fn>).mockResolvedValue(dispute);

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
    expect(body.id).toBe(dispute.id);
    expect(disputeService.createDispute).toHaveBeenCalledWith(
      'user-001',
      'sub-001',
      'This rejection was incorrect because the clip meets all requirements',
      expect.objectContaining({ userId: 'user-001' })
    );
  });

  it('returns 400 when reason is too short', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/disputes',
      headers: { ...userHeaders(), 'content-type': 'application/json' },
      payload: { submissionId: 'sub-001', reason: 'short' },
    });

    expect(res.statusCode).toBe(400);
    expect(disputeService.createDispute).not.toHaveBeenCalled();
  });

  it('returns 400 when submissionId is missing', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/disputes',
      headers: { ...userHeaders(), 'content-type': 'application/json' },
      payload: { reason: 'This rejection was incorrect because the clip meets all requirements' },
    });

    expect(res.statusCode).toBe(400);
  });

  it('returns 401 when not authenticated', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/disputes',
      headers: { 'content-type': 'application/json' },
      payload: { submissionId: 'sub-001', reason: 'valid reason here more than ten chars' },
    });

    expect(res.statusCode).toBe(401);
  });

  it('returns 429 when rate limit is hit', async () => {
    const { ServiceError } = await import('../../../src/lib/errors');
    (disputeService.createDispute as ReturnType<typeof vi.fn>).mockRejectedValue(
      new ServiceError(429, 'TOO_MANY_REQUESTS', 'Please wait at least 5 minutes')
    );

    const res = await app.inject({
      method: 'POST',
      url: '/disputes',
      headers: { ...userHeaders(), 'content-type': 'application/json' },
      payload: {
        submissionId: 'sub-001',
        reason: 'reason with enough characters to pass validation',
      },
    });

    expect(res.statusCode).toBe(429);
    expect(res.json().error.code).toBe('TOO_MANY_REQUESTS');
  });
});

// ---------------------------------------------------------------------------
describe('GET /disputes', () => {
  it('staff can list all disputes', async () => {
    const disputes = [makeDispute(), makeDispute()];
    (disputeService.listDisputes as ReturnType<typeof vi.fn>).mockResolvedValue({
      disputes,
      total: 2,
      page: 1,
      limit: 20,
      totalPages: 1,
    });

    const res = await app.inject({
      method: 'GET',
      url: '/disputes',
      headers: staffHeaders(),
    });

    expect(res.statusCode).toBe(200);
    // Staff call: no userId filter injected
    expect(disputeService.listDisputes).toHaveBeenCalledWith(
      expect.not.objectContaining({ userId: expect.anything() }),
      undefined,
      undefined
    );
  });

  it('non-staff users only see own disputes (userId filter applied)', async () => {
    (disputeService.listDisputes as ReturnType<typeof vi.fn>).mockResolvedValue({
      disputes: [],
      total: 0,
      page: 1,
      limit: 20,
      totalPages: 0,
    });

    const res = await app.inject({
      method: 'GET',
      url: '/disputes',
      headers: userHeaders(),
    });

    expect(res.statusCode).toBe(200);
    expect(disputeService.listDisputes).toHaveBeenCalledWith(
      expect.objectContaining({ userId: 'user-001' }),
      undefined,
      undefined
    );
  });

  it('passes status filter to service', async () => {
    (disputeService.listDisputes as ReturnType<typeof vi.fn>).mockResolvedValue({
      disputes: [],
      total: 0,
      page: 1,
      limit: 20,
      totalPages: 0,
    });

    await app.inject({
      method: 'GET',
      url: '/disputes?status=OPEN',
      headers: staffHeaders(),
    });

    expect(disputeService.listDisputes).toHaveBeenCalledWith(
      expect.objectContaining({ status: 'OPEN' }),
      undefined,
      undefined
    );
  });

  it('returns 401 when not authenticated', async () => {
    const res = await app.inject({ method: 'GET', url: '/disputes' });
    expect(res.statusCode).toBe(401);
  });
});

// ---------------------------------------------------------------------------
describe('GET /disputes/:id', () => {
  it('returns dispute for owner', async () => {
    const dispute = makeDispute({ userId: 'user-001' });
    (disputeService.getDispute as ReturnType<typeof vi.fn>).mockResolvedValue(dispute);

    const res = await app.inject({
      method: 'GET',
      url: `/disputes/${dispute.id}`,
      headers: userHeaders(),
    });

    expect(res.statusCode).toBe(200);
    expect(res.json().id).toBe(dispute.id);
  });

  it('staff can view any dispute', async () => {
    const dispute = makeDispute({ userId: 'other-user' });
    (disputeService.getDispute as ReturnType<typeof vi.fn>).mockResolvedValue(dispute);

    const res = await app.inject({
      method: 'GET',
      url: `/disputes/${dispute.id}`,
      headers: staffHeaders(),
    });

    expect(res.statusCode).toBe(200);
  });

  it('returns 403 when non-staff tries to view another users dispute', async () => {
    const dispute = makeDispute({ userId: 'other-user-999' });
    (disputeService.getDispute as ReturnType<typeof vi.fn>).mockResolvedValue(dispute);

    const res = await app.inject({
      method: 'GET',
      url: `/disputes/${dispute.id}`,
      headers: userHeaders(), // user-001 is not other-user-999
    });

    expect(res.statusCode).toBe(403);
    expect(res.json().error.code).toBe('FORBIDDEN');
  });

  it('returns 404 when dispute does not exist', async () => {
    const { ServiceError } = await import('../../../src/lib/errors');
    (disputeService.getDispute as ReturnType<typeof vi.fn>).mockRejectedValue(
      new ServiceError(404, 'NOT_FOUND', 'Dispute nonexistent not found')
    );

    const res = await app.inject({
      method: 'GET',
      url: '/disputes/nonexistent',
      headers: userHeaders(),
    });

    expect(res.statusCode).toBe(404);
  });

  it('returns 401 when not authenticated', async () => {
    const res = await app.inject({ method: 'GET', url: '/disputes/some-id' });
    expect(res.statusCode).toBe(401);
  });
});

// ---------------------------------------------------------------------------
describe('PATCH /disputes/:id/resolve', () => {
  it('staff can approve a dispute', async () => {
    const resolved = makeDispute({ status: 'APPROVED', resolvedBy: 'staff-001' });
    (disputeService.resolveDispute as ReturnType<typeof vi.fn>).mockResolvedValue(resolved);

    const res = await app.inject({
      method: 'PATCH',
      url: `/disputes/${resolved.id}/resolve`,
      headers: { ...staffHeaders(), 'content-type': 'application/json' },
      payload: { action: 'APPROVE', staffNotes: 'Approved after review' },
    });

    expect(res.statusCode).toBe(200);
    expect(disputeService.resolveDispute).toHaveBeenCalledWith(
      resolved.id,
      'staff-001',
      'APPROVE',
      'Approved after review'
    );
  });

  it('staff can reject a dispute', async () => {
    const rejected = makeDispute({ status: 'REJECTED', resolvedBy: 'staff-001' });
    (disputeService.resolveDispute as ReturnType<typeof vi.fn>).mockResolvedValue(rejected);

    const res = await app.inject({
      method: 'PATCH',
      url: `/disputes/${rejected.id}/resolve`,
      headers: { ...staffHeaders(), 'content-type': 'application/json' },
      payload: { action: 'REJECT' },
    });

    expect(res.statusCode).toBe(200);
    expect(disputeService.resolveDispute).toHaveBeenCalledWith(
      rejected.id,
      'staff-001',
      'REJECT',
      undefined
    );
  });

  it('returns 403 when non-staff tries to resolve', async () => {
    const res = await app.inject({
      method: 'PATCH',
      url: '/disputes/some-id/resolve',
      headers: { ...userHeaders(), 'content-type': 'application/json' },
      payload: { action: 'APPROVE' },
    });

    expect(res.statusCode).toBe(403);
    expect(disputeService.resolveDispute).not.toHaveBeenCalled();
  });

  it('returns 401 when not authenticated', async () => {
    const res = await app.inject({
      method: 'PATCH',
      url: '/disputes/some-id/resolve',
      headers: { 'content-type': 'application/json' },
      payload: { action: 'APPROVE' },
    });

    expect(res.statusCode).toBe(401);
  });

  it('returns 400 when action is invalid', async () => {
    const res = await app.inject({
      method: 'PATCH',
      url: '/disputes/some-id/resolve',
      headers: { ...staffHeaders(), 'content-type': 'application/json' },
      payload: { action: 'INVALID_ACTION' },
    });

    expect(res.statusCode).toBe(400);
    expect(disputeService.resolveDispute).not.toHaveBeenCalled();
  });

  it('returns 400 when trying to resolve already-resolved dispute', async () => {
    const { ServiceError } = await import('../../../src/lib/errors');
    (disputeService.resolveDispute as ReturnType<typeof vi.fn>).mockRejectedValue(
      new ServiceError(400, 'BAD_REQUEST', 'Dispute is not in a resolvable state')
    );

    const res = await app.inject({
      method: 'PATCH',
      url: '/disputes/some-id/resolve',
      headers: { ...staffHeaders(), 'content-type': 'application/json' },
      payload: { action: 'APPROVE' },
    });

    expect(res.statusCode).toBe(400);
    expect(res.json().error.code).toBe('BAD_REQUEST');
  });
});
