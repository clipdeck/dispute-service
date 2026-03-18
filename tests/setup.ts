import { readFileSync } from 'fs';
import { resolve } from 'path';

// ---------------------------------------------------------------------------
// Load .env.test before any module imports that read process.env (config.ts)
// ---------------------------------------------------------------------------
function loadEnvFile(filePath: string): void {
  let content: string;
  try {
    content = readFileSync(filePath, 'utf-8');
  } catch {
    // .env.test not present — rely on whatever is already set
    return;
  }

  for (const line of content.split('\n')) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const eqIdx = trimmed.indexOf('=');
    if (eqIdx === -1) continue;
    const key = trimmed.slice(0, eqIdx).trim();
    const value = trimmed.slice(eqIdx + 1).trim();
    // Only set if not already provided by the CI environment
    if (process.env[key] === undefined) {
      process.env[key] = value;
    }
  }
}

loadEnvFile(resolve(__dirname, '../.env.test'));

// ---------------------------------------------------------------------------
// Prisma mock factories
// Returns plain objects that match the shape of Prisma model types.
// ---------------------------------------------------------------------------

export type MockClipDispute = {
  id: string;
  submissionId: string;
  userId: string;
  reason: string;
  status: 'OPEN' | 'UNDER_REVIEW' | 'APPROVED' | 'REJECTED' | 'CLOSED';
  discordChannelId: string | null;
  discordMessageId: string | null;
  staffNotes: string | null;
  resolvedBy: string | null;
  resolvedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
};

export type MockSupportTicket = {
  id: string;
  userId: string;
  subject: string;
  description: string;
  status: 'OPEN' | 'IN_PROGRESS' | 'WAITING_USER' | 'RESOLVED' | 'CLOSED';
  priority: 'LOW' | 'MEDIUM' | 'HIGH' | 'URGENT';
  discordChannelId: string | null;
  discordMessageId: string | null;
  assignedTo: string | null;
  resolvedBy: string | null;
  resolvedAt: Date | null;
  transcript: string | null;
  createdAt: Date;
  updatedAt: Date;
};

let _idCounter = 0;
function nextId(): string {
  _idCounter += 1;
  return `test-id-${_idCounter.toString().padStart(4, '0')}`;
}

export function makeDispute(overrides: Partial<MockClipDispute> = {}): MockClipDispute {
  const now = new Date();
  return {
    id: nextId(),
    submissionId: 'sub-001',
    userId: 'user-001',
    reason: 'This rejection was incorrect because the clip meets all requirements',
    status: 'OPEN',
    discordChannelId: null,
    discordMessageId: null,
    staffNotes: null,
    resolvedBy: null,
    resolvedAt: null,
    createdAt: now,
    updatedAt: now,
    ...overrides,
  };
}

export function makeTicket(overrides: Partial<MockSupportTicket> = {}): MockSupportTicket {
  const now = new Date();
  return {
    id: nextId(),
    userId: 'user-001',
    subject: 'Test subject',
    description: 'Test description with enough characters',
    status: 'OPEN',
    priority: 'MEDIUM',
    discordChannelId: null,
    discordMessageId: null,
    assignedTo: null,
    resolvedBy: null,
    resolvedAt: null,
    transcript: null,
    createdAt: now,
    updatedAt: now,
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// App builder — creates a Fastify instance for integration tests without
// connecting to RabbitMQ or starting the real HTTP server.
// ---------------------------------------------------------------------------
export async function buildApp() {
  // Dynamic import so config is already patched by loadEnvFile above
  const Fastify = (await import('fastify')).default;
  const cors = (await import('@fastify/cors')).default;
  const helmet = (await import('@fastify/helmet')).default;
  const { config } = await import('../src/config');
  const { disputeRoutes } = await import('../src/routes/disputes');
  const { ticketRoutes } = await import('../src/routes/tickets');

  const app = Fastify({ logger: false });

  await app.register(cors, {
    origin: config.allowedOrigins,
    credentials: true,
  });
  await app.register(helmet);

  app.get('/health', async () => ({ status: 'ok', service: 'dispute-service' }));
  app.get('/ready', async () => ({ status: 'ready', service: 'dispute-service' }));

  await app.register(disputeRoutes, { prefix: '/disputes' });
  await app.register(ticketRoutes, { prefix: '/tickets' });

  return app;
}
