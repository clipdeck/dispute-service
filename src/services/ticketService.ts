import { prisma } from '../lib/prisma';
import { publisher, SERVICE_NAME } from '../lib/events';
import { notFound, badRequest } from '../lib/errors';
import { logger } from '../lib/logger';
import { createTicketChannel, closeChannel } from './discordIntegration';
import type { AuthUser } from '../middleware/auth';
import type { Prisma, TicketStatus, TicketPriority } from '@prisma/client';

// ============================================================================
// Service Functions
// ============================================================================

/**
 * Create a new support ticket
 */
export async function createTicket(
  userId: string,
  subject: string,
  description: string,
  user: AuthUser,
  priority?: string
) {
  const ticket = await prisma.supportTicket.create({
    data: {
      userId,
      subject,
      description,
      priority: (priority as TicketPriority) ?? 'MEDIUM',
      status: 'OPEN',
    },
  });

  // Publish ticket.created event (using raw event since no factory exists)
  await publisher.publishRaw('ticket.created', {
    ticketId: ticket.id,
    userId,
    subject,
    priority: ticket.priority,
  });

  // Create Discord channel for the ticket (non-blocking)
  if (user.discordId && user.name) {
    const channelResult = await createTicketChannel(
      ticket.id,
      user.discordId,
      user.name,
      subject
    );

    if (channelResult) {
      await prisma.supportTicket.update({
        where: { id: ticket.id },
        data: {
          discordChannelId: channelResult.channelId,
          discordMessageId: channelResult.messageId ?? null,
        },
      });
    }
  }

  logger.info({ ticketId: ticket.id, userId, subject }, 'Support ticket created');
  return ticket;
}

/**
 * Get a ticket by ID
 */
export async function getTicket(ticketId: string) {
  const ticket = await prisma.supportTicket.findUnique({
    where: { id: ticketId },
  });

  if (!ticket) throw notFound(`Ticket ${ticketId} not found`);
  return ticket;
}

/**
 * List tickets with filters and pagination
 */
export async function listTickets(
  filters?: { status?: string; priority?: string; assignedTo?: string; userId?: string },
  page = 1,
  limit = 20
) {
  const skip = (page - 1) * limit;

  const where: Prisma.SupportTicketWhereInput = {};
  if (filters?.status) where.status = filters.status as TicketStatus;
  if (filters?.priority) where.priority = filters.priority as TicketPriority;
  if (filters?.assignedTo) where.assignedTo = filters.assignedTo;
  if (filters?.userId) where.userId = filters.userId;

  const [tickets, total] = await Promise.all([
    prisma.supportTicket.findMany({
      where,
      skip,
      take: limit,
      orderBy: { createdAt: 'desc' },
    }),
    prisma.supportTicket.count({ where }),
  ]);

  return { tickets, total, page, limit, totalPages: Math.ceil(total / limit) };
}

/**
 * Update ticket fields (status, priority, assignedTo)
 */
export async function updateTicket(
  ticketId: string,
  data: { status?: string; priority?: string; assignedTo?: string }
) {
  const ticket = await getTicket(ticketId);

  const updateData: Prisma.SupportTicketUpdateInput = {};
  if (data.status) updateData.status = data.status as TicketStatus;
  if (data.priority) updateData.priority = data.priority as TicketPriority;
  if (data.assignedTo !== undefined) updateData.assignedTo = data.assignedTo;

  const updated = await prisma.supportTicket.update({
    where: { id: ticketId },
    data: updateData,
  });

  logger.info({ ticketId, changes: data }, 'Ticket updated');
  return updated;
}

/**
 * Resolve a support ticket
 */
export async function resolveTicket(
  ticketId: string,
  resolverId: string,
  transcript?: string
) {
  const ticket = await getTicket(ticketId);

  if (ticket.status === 'RESOLVED' || ticket.status === 'CLOSED') {
    throw badRequest('Ticket is already resolved or closed');
  }

  const updated = await prisma.supportTicket.update({
    where: { id: ticketId },
    data: {
      status: 'RESOLVED',
      resolvedBy: resolverId,
      resolvedAt: new Date(),
      transcript: transcript ?? null,
    },
  });

  // Publish ticket.resolved event (using raw event since no factory exists)
  await publisher.publishRaw('ticket.resolved', {
    ticketId: ticket.id,
    userId: ticket.userId,
    resolvedBy: resolverId,
    subject: ticket.subject,
  });

  // Close the Discord channel if one exists
  if (ticket.discordChannelId) {
    await closeChannel(ticket.discordChannelId);
  }

  logger.info({ ticketId, resolvedBy: resolverId }, 'Ticket resolved');
  return updated;
}

/**
 * Get all tickets for a specific user
 */
export async function getUserTickets(userId: string) {
  return prisma.supportTicket.findMany({
    where: { userId },
    orderBy: { createdAt: 'desc' },
  });
}
