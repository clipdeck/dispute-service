import { describe, it, expect } from 'vitest';
import { getAuthUser, requireAuth, requireStaff } from '../../../src/middleware/auth';
import type { FastifyRequest } from 'fastify';

// Minimal Fastify request stub
function makeRequest(headers: Record<string, string>): FastifyRequest {
  return { headers } as unknown as FastifyRequest;
}

describe('getAuthUser', () => {
  it('returns null when X-User-Id header is missing', () => {
    const req = makeRequest({});
    expect(getAuthUser(req)).toBeNull();
  });

  it('returns AuthUser when X-User-Id is present', () => {
    const req = makeRequest({ 'x-user-id': 'user-123' });
    const user = getAuthUser(req);
    expect(user).not.toBeNull();
    expect(user!.userId).toBe('user-123');
    expect(user!.isStaff).toBe(false);
  });

  it('parses all optional headers', () => {
    const req = makeRequest({
      'x-user-id': 'user-123',
      'x-user-discord-id': 'discord-456',
      'x-user-email': 'user@example.com',
      'x-user-name': 'Test User',
      'x-user-staff': 'true',
    });
    const user = getAuthUser(req);
    expect(user).toEqual({
      userId: 'user-123',
      discordId: 'discord-456',
      email: 'user@example.com',
      name: 'Test User',
      isStaff: true,
    });
  });

  it('isStaff is false when x-user-staff header is any value other than "true"', () => {
    const req = makeRequest({ 'x-user-id': 'user-123', 'x-user-staff': 'false' });
    expect(getAuthUser(req)!.isStaff).toBe(false);
  });

  it('isStaff is false when x-user-staff header is absent', () => {
    const req = makeRequest({ 'x-user-id': 'user-123' });
    expect(getAuthUser(req)!.isStaff).toBe(false);
  });
});

describe('requireAuth', () => {
  it('returns AuthUser when authenticated', () => {
    const req = makeRequest({ 'x-user-id': 'user-123' });
    const user = requireAuth(req);
    expect(user.userId).toBe('user-123');
  });

  it('throws UNAUTHORIZED when no X-User-Id header', () => {
    const req = makeRequest({});
    expect(() => requireAuth(req)).toThrow(
      expect.objectContaining({ statusCode: 401, code: 'UNAUTHORIZED' })
    );
  });
});

describe('requireStaff', () => {
  it('returns AuthUser when user is staff', () => {
    const req = makeRequest({ 'x-user-id': 'staff-001', 'x-user-staff': 'true' });
    const user = requireStaff(req);
    expect(user.userId).toBe('staff-001');
    expect(user.isStaff).toBe(true);
  });

  it('throws FORBIDDEN when user is authenticated but not staff', () => {
    const req = makeRequest({ 'x-user-id': 'user-001', 'x-user-staff': 'false' });
    expect(() => requireStaff(req)).toThrow(
      expect.objectContaining({ statusCode: 403, code: 'FORBIDDEN' })
    );
  });

  it('throws UNAUTHORIZED when not authenticated at all', () => {
    const req = makeRequest({});
    expect(() => requireStaff(req)).toThrow(
      expect.objectContaining({ statusCode: 401, code: 'UNAUTHORIZED' })
    );
  });
});
