import { generateId } from '@agency-os/database';
import type { Request, Response } from 'express';

export const CORRELATION_ID_REGEX = /^[a-zA-Z0-9._-]{1,128}$/;

/**
 * Validates whether a candidate string is a safe, conformant correlation ID.
 */
export function isValidCorrelationId(id: unknown): id is string {
  return typeof id === 'string' && CORRELATION_ID_REGEX.test(id);
}

/**
 * Extracts and validates the correlation ID from an Express Request or incoming object.
 * Priority:
 * 1. Pre-assigned request ID (e.g. from pino-http middleware req.id).
 * 2. Incoming 'x-request-id' header (handles string or array of strings safely).
 * Returns the valid correlation ID, or undefined if absent or invalid.
 */
export function extractCorrelationId(
  req?: Request | Record<string, any>,
): string | undefined {
  if (!req) return undefined;

  // 1. Check req.id (assigned by pino-http or upstream reverse proxy)
  if (isValidCorrelationId((req as any).id)) {
    return (req as any).id;
  }

  // 2. Check req.headers['x-request-id']
  if (req.headers && req.headers['x-request-id'] !== undefined) {
    const raw = req.headers['x-request-id'];
    const candidate = Array.isArray(raw) ? raw[0] : raw;
    if (isValidCorrelationId(candidate)) {
      return candidate;
    }
  }

  return undefined;
}

/**
 * Resolves a guaranteed valid correlation ID for the request.
 * If no valid correlation ID exists, generates a fresh unique identifier.
 */
export function getOrCreateCorrelationId(
  req?: Request | Record<string, any>,
): string {
  return extractCorrelationId(req) ?? generateId();
}

/**
 * Attaches the correlation ID to the response header if not already sent.
 */
export function attachCorrelationIdToResponse(
  res: Response | Record<string, any>,
  correlationId: string,
): void {
  if (
    res &&
    !res.headersSent &&
    typeof res.setHeader === 'function' &&
    isValidCorrelationId(correlationId)
  ) {
    res.setHeader('x-request-id', correlationId);
  }
}
