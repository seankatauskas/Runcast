import type { FastifyReply, FastifyRequest } from 'fastify';
import type { z } from 'zod';
import { AppError } from './errors';

export function parseBody<T extends z.ZodTypeAny>(schema: T, request: FastifyRequest): z.infer<T> {
  const result = schema.safeParse(request.body);
  if (!result.success) {
    throw new AppError(400, 'INVALID_REQUEST', 'Request body is invalid', result.error.flatten());
  }
  return result.data;
}

export function noStore(reply: FastifyReply): void {
  reply.header('cache-control', 'no-store');
}

export function iso(value: Date): string {
  return value.toISOString();
}
