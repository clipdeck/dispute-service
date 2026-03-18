import { describe, it, expect, vi, beforeEach } from 'vitest';

// ---------------------------------------------------------------------------
// Mocks — vi.mock factories are hoisted, so no variables from outer scope
// ---------------------------------------------------------------------------

vi.mock('../../../src/lib/events', () => ({
  consumer: { on: vi.fn() },
  publisher: { publish: vi.fn(), publishRaw: vi.fn() },
  DisputeEvents: {
    created: vi.fn(),
    resolved: vi.fn(),
  },
  SERVICE_NAME: 'dispute-service',
}));

vi.mock('../../../src/services/cacheService', () => ({
  syncSubmissionCache: vi.fn().mockResolvedValue(undefined),
}));

// withRetry and withLogging are pass-through wrappers during tests
vi.mock('@clipdeck/events', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@clipdeck/events')>();
  return {
    ...actual,
    withRetry: (fn: unknown) => fn,
    withLogging: (fn: unknown, _logger: unknown) => fn,
  };
});

// ---------------------------------------------------------------------------
import { registerEventHandlers } from '../../../src/events/handlers';
import { consumer } from '../../../src/lib/events';
import { syncSubmissionCache } from '../../../src/services/cacheService';

beforeEach(() => {
  vi.clearAllMocks();
});

// ---------------------------------------------------------------------------
describe('registerEventHandlers', () => {
  it('registers handlers for clip.rejected, clip.approved, and clip.submitted', () => {
    registerEventHandlers();

    const onMock = consumer.on as ReturnType<typeof vi.fn>;
    const registeredKeys = onMock.mock.calls.map((call) => call[0] as string);
    expect(registeredKeys).toContain('clip.rejected');
    expect(registeredKeys).toContain('clip.approved');
    expect(registeredKeys).toContain('clip.submitted');
    expect(onMock).toHaveBeenCalledTimes(3);
  });
});

// ---------------------------------------------------------------------------
describe('clip.rejected handler', () => {
  it('calls syncSubmissionCache with REJECTED status', async () => {
    registerEventHandlers();

    const onMock = consumer.on as ReturnType<typeof vi.fn>;
    const rejectedCall = onMock.mock.calls.find((call) => call[0] === 'clip.rejected');
    expect(rejectedCall).toBeDefined();
    const handler = rejectedCall![1] as (event: unknown, ctx: unknown) => Promise<void>;

    const event = {
      type: 'clip.rejected',
      payload: {
        clipId: 'clip-001',
        userId: 'user-001',
        reason: 'Poor quality',
        campaignId: 'campaign-001',
      },
    };

    await handler(event, {});

    expect(syncSubmissionCache).toHaveBeenCalledWith('clip-001', {
      campaignId: 'campaign-001',
      editorId: 'user-001',
      status: 'REJECTED',
    });
  });
});

// ---------------------------------------------------------------------------
describe('clip.approved handler', () => {
  it('calls syncSubmissionCache with APPROVED status', async () => {
    registerEventHandlers();

    const onMock = consumer.on as ReturnType<typeof vi.fn>;
    const approvedCall = onMock.mock.calls.find((call) => call[0] === 'clip.approved');
    expect(approvedCall).toBeDefined();
    const handler = approvedCall![1] as (event: unknown, ctx: unknown) => Promise<void>;

    const event = {
      type: 'clip.approved',
      payload: {
        clipId: 'clip-002',
        userId: 'user-002',
        campaignId: 'campaign-002',
      },
    };

    await handler(event, {});

    expect(syncSubmissionCache).toHaveBeenCalledWith('clip-002', {
      campaignId: 'campaign-002',
      editorId: 'user-002',
      status: 'APPROVED',
    });
  });
});

// ---------------------------------------------------------------------------
describe('clip.submitted handler', () => {
  it('calls syncSubmissionCache with SUBMITTED status', async () => {
    registerEventHandlers();

    const onMock = consumer.on as ReturnType<typeof vi.fn>;
    const submittedCall = onMock.mock.calls.find((call) => call[0] === 'clip.submitted');
    expect(submittedCall).toBeDefined();
    const handler = submittedCall![1] as (event: unknown, ctx: unknown) => Promise<void>;

    const event = {
      type: 'clip.submitted',
      payload: {
        clipId: 'clip-003',
        userId: 'user-003',
        campaignId: 'campaign-003',
        platform: 'TIKTOK',
        linkUrl: 'https://tiktok.com/video/123',
      },
    };

    await handler(event, {});

    expect(syncSubmissionCache).toHaveBeenCalledWith('clip-003', {
      campaignId: 'campaign-003',
      platform: 'TIKTOK',
      linkUrl: 'https://tiktok.com/video/123',
      editorId: 'user-003',
      status: 'SUBMITTED',
    });
  });
});
