import { prisma } from '../lib/prisma';
import { clipClient } from '../lib/serviceClients';
import { logger } from '../lib/logger';

const CACHE_TTL_MS = 10 * 60 * 1000; // 10 minutes (submissions change less often)

function isRecent(date: Date): boolean {
  return Date.now() - date.getTime() < CACHE_TTL_MS;
}

/**
 * Sync submission data into local cache (from event payload or API)
 */
export async function syncSubmissionCache(
  submissionId: string,
  data?: { campaignId?: string; platform?: string; linkUrl?: string; editorId?: string; status?: string }
): Promise<void> {
  try {
    if (data && data.campaignId) {
      await prisma.submissionCache.upsert({
        where: { id: submissionId },
        update: { ...data, syncedAt: new Date() },
        create: {
          id: submissionId,
          campaignId: data.campaignId,
          platform: data.platform || 'UNKNOWN',
          linkUrl: data.linkUrl,
          editorId: data.editorId,
          status: data.status,
          syncedAt: new Date(),
        },
      });
      return;
    }

    if (!clipClient) {
      logger.warn('Clip service URL not configured, skipping submission cache sync');
      return;
    }

    const response = await clipClient.get(`/clips/${submissionId}`);
    const submission = response.data;

    await prisma.submissionCache.upsert({
      where: { id: submissionId },
      update: {
        campaignId: submission.campaignId,
        platform: submission.platform,
        linkUrl: submission.linkUrl,
        editorId: submission.editorId,
        status: submission.status,
        syncedAt: new Date(),
      },
      create: {
        id: submissionId,
        campaignId: submission.campaignId,
        platform: submission.platform,
        linkUrl: submission.linkUrl,
        editorId: submission.editorId,
        status: submission.status,
        syncedAt: new Date(),
      },
    });
  } catch (error) {
    logger.error({ submissionId, error }, 'Failed to sync submission cache');
  }
}

/**
 * Get submission data from cache, refreshing if stale
 */
export async function getSubmissionFromCache(submissionId: string) {
  const cached = await prisma.submissionCache.findUnique({ where: { id: submissionId } });

  if (cached && isRecent(cached.syncedAt)) {
    return cached;
  }

  await syncSubmissionCache(submissionId);
  return prisma.submissionCache.findUnique({ where: { id: submissionId } });
}
