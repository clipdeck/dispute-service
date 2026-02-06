import { z } from 'zod';
import { badRequest } from '../lib/errors';

/**
 * Validate request body against a Zod schema. Returns parsed data or throws ServiceError.
 */
export function validateBody<T>(schema: z.ZodType<T>, body: unknown): T {
  const result = schema.safeParse(body);
  if (!result.success) {
    throw badRequest('Validation error', result.error.flatten().fieldErrors);
  }
  return result.data;
}

/**
 * Validate query params against a Zod schema.
 */
export function validateQuery<T>(schema: z.ZodType<T>, query: unknown): T {
  const result = schema.safeParse(query);
  if (!result.success) {
    throw badRequest('Invalid query parameters', result.error.flatten().fieldErrors);
  }
  return result.data;
}
