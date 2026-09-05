import crypto from 'node:crypto';
import type { RequestHandler } from 'express';
import type { AuthInfo } from '@modelcontextprotocol/sdk/server/auth/types.js';
type TokenRow = Record<string, any>;

export type AccessTokenModel = { findOne: (options: { where: Record<string, unknown> }) => Promise<TokenRow | null> };
export type McpAuthInfo = AuthInfo & { extra: { userId: number; tokenId: number } };
const reject = (res: Parameters<RequestHandler>[1], status: number, error: string) =>
  res.status(status).json({ error });
const normalizeHost = (value: string) => value.trim().toLowerCase().replace(/\.$/, '');

export function createMcpGuardMiddleware(options: {
  trustedHosts: readonly string[];
  frontendOrigin: string;
}): RequestHandler {
  const hosts = new Set(options.trustedHosts.map(normalizeHost).filter(Boolean));
  return (req, res, next) => {
    if (!hosts.has(normalizeHost(req.get('host') ?? ''))) return reject(res, 403, 'Untrusted MCP host');
    const origin = req.get('origin');
    if (origin && origin !== options.frontendOrigin) return reject(res, 403, 'Untrusted MCP origin');
    return next();
  };
}

function bearerToken(req: Parameters<RequestHandler>[0]): string | null {
  if (req.query.token !== undefined || req.query.access_token !== undefined) return null;
  const match = /^Bearer ([^\s]+)$/i.exec(req.get('authorization') ?? '');
  return match?.[1] ?? null;
}

function scopesOf(value: any): string[] | null {
  let scopes: unknown = value;
  if (typeof scopes === 'string') {
    try {
      scopes = JSON.parse(scopes);
    } catch {
      return null;
    }
  }
  if (!Array.isArray(scopes) || !scopes.includes('read') || scopes.some((scope) => !['read', 'write'].includes(scope)))
    return null;
  return [...new Set(scopes)];
}

export function createMcpAuthMiddleware(options: {
  accessTokenModel: AccessTokenModel;
  now?: () => Date;
}): RequestHandler {
  const now = options.now ?? (() => new Date());
  return async (req, res, next) => {
    const secret = bearerToken(req);
    if (!secret) return reject(res, 401, 'Invalid MCP bearer token');
    try {
      const token = await options.accessTokenModel.findOne({
        where: { tokenHash: crypto.createHash('sha256').update(secret).digest('hex') },
      });
      const scopes = token && scopesOf(token.scopes);
      const expiresAt = token && new Date(token.expiresAt);
      if (!token || !scopes || token.revokedAt || !expiresAt || expiresAt.getTime() <= now().getTime())
        return reject(res, 401, 'Invalid MCP bearer token');
      await token.update?.({ lastUsedAt: now() });
      (req as typeof req & { auth?: McpAuthInfo }).auth = {
        token: secret,
        clientId: String(token.id),
        scopes,
        expiresAt: Math.floor(expiresAt.getTime() / 1000),
        extra: { userId: Number(token.userId), tokenId: Number(token.id) },
      };
      return next();
    } catch (error) {
      return next(error);
    }
  };
}
