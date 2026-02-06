import { prisma } from '../lib/prisma';
import { publisher, DisputeEvents, SERVICE_NAME } from '../lib/events';
import { notFound, badRequest, tooManyRequests } from '../lib/errors';
import { logger } from '../lib/logger';
import { createDisputeChannel, closeChannel } from './discordIntegration';
import type { AuthUser } from '../middleware/auth';
import type { Prisma, DisputeStatus } from '@prisma/client';

// ============================================================================
// Rate Limiting Constants
// ============================================================================

const DISPUTE_LIMIT_PER_DAY = 3;
const DISPUTE_COOLDOWN_MS = 5 * 60 * 1000; // 5 minutes

// ============================================================================
// Service Functions
// ============================================================================

/**
 * Create a new clip dispute
 */
export async function createDispute(
  userId: string,
  submissionId: string,
  reason: string,
  user: AuthUser
) {
  // Rate limiting: check cooldown (most recent dispute within 5 min)
  const cooldownTime = new Date(Date.now() - DISPUTE_COOLDOWN_MS);
  const recentDispute = await prisma.clipDispute.findFirst({
    where: {
      userId,
      createdAt: { gte: cooldownTime },
    },
    orderBy: { createdAt: 'desc' },
  });

  if (recentDispute) {
    throw tooManyRequests(
      'Please wait at least 5 minutes between dispute submissions'
    );
  }

  // Rate limiting: check daily limit
  const startOfDay = new Date();
  startOfDay.setHours(0, 0, 0, 0);

  const dailyCount = await prisma.clipDispute.count({
    where: {
      userId,
      createdAt: { gte: startOfDay },
    },
  });

  if (dailyCount >= DISPUTE_LIMIT_PER_DAY) {
    throw tooManyRequests(
      `You can only submit ${DISPUTE_LIMIT_PER_DAY} disputes per day`
    );
  }

  // Create the dispute
  const dispute = await prisma.clipDispute.create({
    data: {
      userId,
      submissionId,
      reason,
      status: 'OPEN',
    },
  });

  // Publish dispute.created event
  const event = DisputeEvents.created(
    {
      disputeId: dispute.id,
      clipId: submissionId,
      userId,
      campaignId: '', // Not tracked on the dispute model; consumer can look up
      reason,
    },
    SERVICE_NAME
  );
  await publisher.publish(event);

  // Create Discord channel for the dispute (non-blocking)
  if (user.discordId && user.name) {
    const channelResult = await createDisputeChannel(
      dispute.id,
      user.discordId,
      user.name,
      submissionId
    );

    if (channelResult) {
      await prisma.clipDispute.update({
        where: { id: dispute.id },
        data: {
          discordChannelId: channelResult.channelId,
          discordMessageId: channelResult.messageId ?? null,
        },
      });
    }
  }

  logger.info({ disputeId: dispute.id, userId, submissionId }, 'Dispute created');
  return dispute;
}

/**
 * Get a dispute by ID
 */
export async function getDispute(disputeId: string) {
  const dispute = await prisma.clipDispute.findUnique({
    where: { id: disputeId },
  });

  if (!dispute) throw notFound(`Dispute ${disputeId} not found`);
  return dispute;
}

/**
 * List disputes with filters and pagination
 */
export async function listDisputes(
  filters?: { status?: string; userId?: string },
  page = 1,
  limit = 20
) {
  const skip = (page - 1) * limit;

  const where: Prisma.ClipDisputeWhereInput = {};
  if (filters?.status) where.status = filters.status as DisputeStatus;
  if (filters?.userId) where.userId = filters.userId;

  const [disputes, total] = await Promise.all([
    prisma.clipDispute.findMany({
      where,
      skip,
      take: limit,
      orderBy: { createdAt: 'desc' },
    }),
    prisma.clipDispute.count({ where }),
  ]);

  return { disputes, total, page, limit, totalPages: Math.ceil(total / limit) };
}

/**
 * Resolve a dispute (approve or reject)
 */
export async function resolveDispute(
  disputeId: string,
  resolverId: string,
  action: 'APPROVE' | 'REJECT',
  staffNotes?: string
) {
  const dispute = await getDispute(disputeId);

  if (dispute.status !== 'OPEN' && dispute.status !== 'UNDER_REVIEW') {
    throw badRequest('Dispute is not in a resolvable state');
  }

  const newStatus = action === 'APPROVE' ? 'APPROVED' : 'REJECTED';

  const updated = await prisma.clipDispute.update({
    where: { id: disputeId },
    data: {
      status: newStatus,
      resolvedBy: resolverId,
      resolvedAt: new Date(),
      staffNotes: staffNotes ?? null,
    },
  });

  // Publish the appropriate event
  const resolution = action === 'APPROVE' ? 'APPROVED' : 'REJECTED';
  const eventStatus = action === 'APPROVE' ? 'RESOLVED' as const : 'REJECTED' as const;

  const event = DisputeEvents.resolved(
    {
      disputeId: dispute.id,
      clipId: dispute.submissionId,
      userId: dispute.userId,
      resolution,
      status: eventStatus,
      resolvedBy: resolverId,
    },
    SERVICE_NAME
  );
  await publisher.publish(event);

  // Close the Discord channel if one exists
  if (dispute.discordChannelId) {
    await closeChannel(dispute.discordChannelId);
  }

  logger.info(
    { disputeId, action, resolvedBy: resolverId },
    'Dispute resolved'
  );

  return updated;
}

/**
 * Get all disputes for a specific user
 */
export async function getUserDisputes(userId: string) {
  return prisma.clipDispute.findMany({
    where: { userId },
    orderBy: { createdAt: 'desc' },
  });
}
