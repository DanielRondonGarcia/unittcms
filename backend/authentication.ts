import { randomUUID } from 'node:crypto';
import jwt from 'jsonwebtoken';
import type { Request, Response } from 'express';
import { SECRET_KEY } from './config/config.js';

export async function expressAuthentication(
  request: Request,
  securityName: string,
  _scopes?: string[],
  response?: Response
): Promise<unknown> {
  if (securityName !== 'jwt') throw Object.assign(new Error('Unsupported authentication scheme'), { status: 401 });
  const token = request.header('Authorization')?.split(' ').pop();
  try {
    if (!token) throw new Error('missing token');
    const decoded = jwt.verify(token, SECRET_KEY);
    const userId = Number(typeof decoded === 'object' && decoded ? decoded.userId : NaN);
    if (!Number.isInteger(userId) || userId <= 0) throw new Error('invalid token');
    (request as Request & { userId?: number }).userId = userId;
    return decoded;
  } catch {
    if (response && !response.writableEnded)
      response
        .status(401)
        .json({ error: 'unauthenticated', correlationId: request.header('X-Correlation-Id') ?? randomUUID() });
    throw Object.assign(new Error('unauthenticated'), { status: 401 });
  }
}
