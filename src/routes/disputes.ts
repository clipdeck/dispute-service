import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { requireAuth, requireStaff } from '../middleware/auth';
import { validateBody, validateQuery } from '../middleware/validation';
import { sendError } from '../lib/errors';
import * as disputeService from '../services/disputeService';

const createDisputeSchema = z.object({
  submissionId: z.string().min(1),
  reason: z.string().min(10, 'Reason must be at least 10 characters'),
});

const listDisputesQuerySchema = z.object({
  status: z.string().optional(),
  page: z.coerce.number().int().positive().optional(),
  limit: z.coerce.number().int().positive().max(100).optional(),
});

const resolveDisputeSchema = z.object({
  action: z.enum(['APPROVE', 'REJECT']),
  staffNotes: z.string().optional(),
});

export async function disputeRoutes(app: FastifyInstance) {
  // GET /disputes/mine - Get my disputes (must be before /:id)
  app.get('/mine', async (request, reply) => {
    try {
      const user = requireAuth(request);
      const disputes = await disputeService.getUserDisputes(user.userId);
      return disputes;
    } catch (error) {
      sendError(reply, error);
    }
  });

  // POST /disputes - Create dispute
  app.post('/', async (request, reply) => {
    try {
      const user = requireAuth(request);
      const body = validateBody(createDisputeSchema, request.body);
      const dispute = await disputeService.createDispute(
        user.userId,
        body.submissionId,
        body.reason,
        user
      );
      reply.status(201);
      return dispute;
    } catch (error) {
      sendError(reply, error);
    }
  });

  // GET /disputes - List disputes (staff sees all, users see own)
  app.get('/', async (request, reply) => {
    try {
      const user = requireAuth(request);
      const query = validateQuery(listDisputesQuerySchema, request.query);

      const filters: { status?: string; userId?: string } = {};
      if (query.status) filters.status = query.status;

      // Non-staff users can only see their own disputes
      if (!user.isStaff) {
        filters.userId = user.userId;
      }

      const result = await disputeService.listDisputes(
        filters,
        query.page,
        query.limit
      );
      return result;
    } catch (error) {
      sendError(reply, error);
    }
  });

  // GET /disputes/:id - Get dispute
  app.get<{ Params: { id: string } }>('/:id', async (request, reply) => {
    try {
      const user = requireAuth(request);
      const dispute = await disputeService.getDispute(request.params.id);

      // Non-staff users can only view their own disputes
      if (!user.isStaff && dispute.userId !== user.userId) {
        return reply.status(403).send({
          error: { code: 'FORBIDDEN', message: 'You can only view your own disputes' },
        });
      }

      return dispute;
    } catch (error) {
      sendError(reply, error);
    }
  });

  // PATCH /disputes/:id/resolve - Resolve dispute (staff/admin only)
  app.patch<{ Params: { id: string } }>('/:id/resolve', async (request, reply) => {
    try {
      const user = requireStaff(request);
      const body = validateBody(resolveDisputeSchema, request.body);
      const updated = await disputeService.resolveDispute(
        request.params.id,
        user.userId,
        body.action,
        body.staffNotes
      );
      return updated;
    } catch (error) {
      sendError(reply, error);
    }
  });
}
