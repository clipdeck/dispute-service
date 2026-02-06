import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { requireAuth, requireStaff } from '../middleware/auth';
import { validateBody, validateQuery } from '../middleware/validation';
import { sendError } from '../lib/errors';
import * as ticketService from '../services/ticketService';

const createTicketSchema = z.object({
  subject: z.string().min(3, 'Subject must be at least 3 characters'),
  description: z.string().min(10, 'Description must be at least 10 characters'),
  priority: z.enum(['LOW', 'MEDIUM', 'HIGH', 'URGENT']).optional(),
});

const listTicketsQuerySchema = z.object({
  status: z.string().optional(),
  priority: z.string().optional(),
  page: z.coerce.number().int().positive().optional(),
  limit: z.coerce.number().int().positive().max(100).optional(),
});

const updateTicketSchema = z.object({
  status: z.enum(['OPEN', 'IN_PROGRESS', 'WAITING_USER', 'RESOLVED', 'CLOSED']).optional(),
  priority: z.enum(['LOW', 'MEDIUM', 'HIGH', 'URGENT']).optional(),
  assignedTo: z.string().nullable().optional(),
});

const resolveTicketSchema = z.object({
  transcript: z.string().optional(),
});

export async function ticketRoutes(app: FastifyInstance) {
  // GET /tickets/mine - Get my tickets (must be before /:id)
  app.get('/mine', async (request, reply) => {
    try {
      const user = requireAuth(request);
      const tickets = await ticketService.getUserTickets(user.userId);
      return tickets;
    } catch (error) {
      sendError(reply, error);
    }
  });

  // POST /tickets - Create ticket
  app.post('/', async (request, reply) => {
    try {
      const user = requireAuth(request);
      const body = validateBody(createTicketSchema, request.body);
      const ticket = await ticketService.createTicket(
        user.userId,
        body.subject,
        body.description,
        user,
        body.priority
      );
      reply.status(201);
      return ticket;
    } catch (error) {
      sendError(reply, error);
    }
  });

  // GET /tickets - List tickets (staff sees all, users see own)
  app.get('/', async (request, reply) => {
    try {
      const user = requireAuth(request);
      const query = validateQuery(listTicketsQuerySchema, request.query);

      const filters: { status?: string; priority?: string; assignedTo?: string; userId?: string } = {};
      if (query.status) filters.status = query.status;
      if (query.priority) filters.priority = query.priority;

      // Non-staff users can only see their own tickets
      if (!user.isStaff) {
        filters.userId = user.userId;
      }

      const result = await ticketService.listTickets(
        filters,
        query.page,
        query.limit
      );
      return result;
    } catch (error) {
      sendError(reply, error);
    }
  });

  // GET /tickets/:id - Get ticket
  app.get<{ Params: { id: string } }>('/:id', async (request, reply) => {
    try {
      const user = requireAuth(request);
      const ticket = await ticketService.getTicket(request.params.id);

      // Non-staff users can only view their own tickets
      if (!user.isStaff && ticket.userId !== user.userId) {
        return reply.status(403).send({
          error: { code: 'FORBIDDEN', message: 'You can only view your own tickets' },
        });
      }

      return ticket;
    } catch (error) {
      sendError(reply, error);
    }
  });

  // PATCH /tickets/:id - Update ticket (staff only)
  app.patch<{ Params: { id: string } }>('/:id', async (request, reply) => {
    try {
      requireStaff(request);
      const body = validateBody(updateTicketSchema, request.body);
      const updated = await ticketService.updateTicket(
        request.params.id,
        {
          status: body.status,
          priority: body.priority,
          assignedTo: body.assignedTo ?? undefined,
        }
      );
      return updated;
    } catch (error) {
      sendError(reply, error);
    }
  });

  // PATCH /tickets/:id/resolve - Resolve ticket (staff only)
  app.patch<{ Params: { id: string } }>('/:id/resolve', async (request, reply) => {
    try {
      const user = requireStaff(request);
      const body = validateBody(resolveTicketSchema, request.body);
      const updated = await ticketService.resolveTicket(
        request.params.id,
        user.userId,
        body.transcript
      );
      return updated;
    } catch (error) {
      sendError(reply, error);
    }
  });
}
