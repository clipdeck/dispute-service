import { createPublisher, createConsumer, DisputeEvents } from '@clipdeck/events';
import type { EventPublisher, EventConsumer } from '@clipdeck/events';
import { config } from '../config';
import { logger } from './logger';

const SERVICE_NAME = 'dispute-service';

export const publisher: EventPublisher = createPublisher({
  serviceName: SERVICE_NAME,
  connectionUrl: config.rabbitmqUrl,
  exchange: config.eventExchange,
  enableLogging: true,
  logger: {
    info: (msg, data) => logger.info(data, msg),
    error: (msg, err) => logger.error(err, msg),
    debug: (msg, data) => logger.debug(data, msg),
  },
});

export const consumer: EventConsumer = createConsumer({
  serviceName: SERVICE_NAME,
  connectionUrl: config.rabbitmqUrl,
  queueName: 'dispute.events',
  exchange: config.eventExchange,
  routingKeys: ['clip.rejected', 'clip.approved', 'clip.submitted'],
  enableLogging: true,
  logger: {
    info: (msg, data) => logger.info(data, msg),
    error: (msg, err) => logger.error(err, msg),
    debug: (msg, data) => logger.debug(data, msg),
  },
});

export { DisputeEvents, SERVICE_NAME };
