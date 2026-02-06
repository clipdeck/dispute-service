import { consumer } from '../lib/events';
import { logger } from '../lib/logger';
import { withRetry, withLogging } from '@clipdeck/events';
import type { ClipRejectedEvent } from '@clipdeck/events';
import { syncSubmissionCache } from '../services/cacheService';

/**
 * Register event handlers for the dispute-service consumer.
 *
 * Queue: dispute.events
 * Routing Keys: clip.rejected, clip.approved, clip.submitted
 */
export function registerEventHandlers(): void {
  // Handle clip.rejected - log for context + cache submission data
  consumer.on(
    'clip.rejected',
    withRetry(
      withLogging(
        async (event: ClipRejectedEvent, _context) => {
          const { clipId, userId, reason, campaignId } = event.payload;

          logger.info(
            { clipId, userId, reason },
            'Clip rejected event received - user may file a dispute'
          );

          // Cache submission info for dispute context
          await syncSubmissionCache(clipId, {
            campaignId,
            editorId: userId,
            status: 'REJECTED',
          });
        },
        { info: (msg, data) => logger.info(data, msg) }
      )
    )
  );

  // Handle clip.approved - cache submission data
  consumer.on(
    'clip.approved',
    withRetry(
      withLogging(
        async (event, _context) => {
          const { clipId, campaignId, userId } = event.payload;

          await syncSubmissionCache(clipId, {
            campaignId,
            editorId: userId,
            status: 'APPROVED',
          });

          logger.debug({ clipId }, 'Clip approved - submission cached');
        },
        { info: (msg, data) => logger.info(data, msg) }
      )
    )
  );

  // Handle clip.submitted - cache submission data
  consumer.on(
    'clip.submitted',
    withRetry(
      withLogging(
        async (event, _context) => {
          const { clipId, campaignId, platform, linkUrl, userId } = event.payload;

          await syncSubmissionCache(clipId, {
            campaignId,
            platform,
            linkUrl,
            editorId: userId,
            status: 'SUBMITTED',
          });

          logger.debug({ clipId }, 'Clip submitted - submission cached');
        },
        { info: (msg, data) => logger.info(data, msg) }
      )
    )
  );
}
