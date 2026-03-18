import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import type { FastifyInstance } from 'fastify';

// Stub out infrastructure that is not needed for health checks
vi.mock('../../src/lib/prisma', () => ({ prisma: {} }));
vi.mock('../../src/lib/events', () => ({
  publisher: { connect: vi.fn(), disconnect: vi.fn(), publish: vi.fn(), publishRaw: vi.fn() },
  consumer: { start: vi.fn(), stop: vi.fn(), on: vi.fn() },
  DisputeEvents: { created: vi.fn(), resolved: vi.fn() },
  SERVICE_NAME: 'dispute-service',
}));
vi.mock('../../src/services/disputeService', () => ({}));
vi.mock('../../src/services/ticketService', () => ({}));

import { buildApp } from '../setup';

let app: FastifyInstance;

beforeEach(async () => {
  app = await buildApp();
});

afterEach(async () => {
  await app.close();
});

describe('GET /health', () => {
  it('returns 200 with status ok', async () => {
    const res = await app.inject({ method: 'GET', url: '/health' });

    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.status).toBe('ok');
    expect(body.service).toBe('dispute-service');
  });

  it('does not require authentication', async () => {
    // No headers at all — should still return 200
    const res = await app.inject({ method: 'GET', url: '/health' });
    expect(res.statusCode).toBe(200);
  });
});

describe('GET /ready', () => {
  it('returns 200 with status ready', async () => {
    const res = await app.inject({ method: 'GET', url: '/ready' });

    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.status).toBe('ready');
    expect(body.service).toBe('dispute-service');
  });

  it('does not require authentication', async () => {
    const res = await app.inject({ method: 'GET', url: '/ready' });
    expect(res.statusCode).toBe(200);
  });
});
