import Fastify from 'fastify';
import cors from '@fastify/cors';
import helmet from '@fastify/helmet';
import { config } from './config';
import { logger } from './lib/logger';
import { register } from './lib/metrics';
import { disputeRoutes } from './routes/disputes';
import { ticketRoutes } from './routes/tickets';
import { publisher, consumer } from './lib/events';
import { registerEventHandlers } from './events/handlers';

async function main() {
  const app = Fastify({
    loggerInstance: logger,
  });

  // Plugins
  await app.register(cors, {
    origin: config.allowedOrigins,
    credentials: true,
  });
  await app.register(helmet);

  // Metrics endpoint for Prometheus scraping
  app.get('/metrics', async (_req, reply) => {
    reply.header('Content-Type', register.contentType);
    return reply.send(await register.metrics());
  });

  // Health check
  app.get('/health', async () => ({ status: 'ok', service: 'dispute-service' }));
  app.get('/ready', async () => {
    // Could add DB connectivity check here
    return { status: 'ready', service: 'dispute-service' };
  });

  // Routes
  await app.register(disputeRoutes, { prefix: '/disputes' });
  await app.register(ticketRoutes, { prefix: '/tickets' });

  // Connect event publisher
  await publisher.connect();

  // Register event handlers and start consumer
  registerEventHandlers();
  await consumer.start();

  // Graceful shutdown
  const shutdown = async () => {
    logger.info('Shutting down...');
    await consumer.stop();
    await publisher.disconnect();
    await app.close();
    process.exit(0);
  };

  process.on('SIGTERM', shutdown);
  process.on('SIGINT', shutdown);

  // Start server
  await app.listen({ port: config.port, host: config.host });
  logger.info(`Dispute service listening on ${config.host}:${config.port}`);
}

main().catch((err) => {
  logger.error(err, 'Failed to start dispute service');
  process.exit(1);
});
