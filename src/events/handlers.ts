import { consumer } from '../lib/events';
import { logger } from '../lib/logger';
import { withRetry, withLogging } from '@clipdeck/events';
import type { ClipRejectedEvent } from '@clipdeck/events';

/**
 * Register event handlers for the dispute-service consumer.
 *
 * Queue: dispute.events
 * Routing Keys: clip.rejected
 */
export function registerEventHandlers(): void {
  // Handle clip.rejected - log for context; user can file dispute via API
  consumer.on(
    'clip.rejected',
    withRetry(
      withLogging(
        async (event: ClipRejectedEvent, _context) => {
          const { clipId, userId, reason } = event.payload;

          logger.info(
            { clipId, userId, reason },
            'Clip rejected event received - user may file a dispute'
          );

          // Optional: Could create an in-app notification here
          // or enrich user data for future dispute context.
          // For now, we just log it. The user can initiate a dispute
          // via the API if they want.
        },
        { info: (msg, data) => logger.info(data, msg) }
      )
    )
  );
}
