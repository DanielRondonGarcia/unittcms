import crypto from 'node:crypto';
import express from 'express';
import request from 'supertest';
import { describe, expect, it, vi } from 'vitest';
import { registerMcpRoute, registerScopedTool } from './server.js';
const now = new Date('2026-09-05T12:00:00.000Z');
const initialize = {
  jsonrpc: '2.0',
  id: 1,
  method: 'initialize',
  params: { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 'test', version: '1' } },
};
function token(secret: string, values: Record<string, unknown> = {}) {
  return {
    id: 1,
    userId: 7,
    tokenHash: crypto.createHash('sha256').update(secret).digest('hex'),
    scopes: ['read', 'write'],
    expiresAt: new Date(now.getTime() + 3600000),
    revokedAt: null,
    update: vi.fn(),
    ...values,
  };
}
function appFor(tokens: Record<string, ReturnType<typeof token>>) {
  const AccessToken = {
    findOne: vi.fn(
      async ({ where }: { where: { tokenHash: string } }) =>
        Object.values(tokens).find((entry) => entry.tokenHash === where.tokenHash) ?? null
    ),
  };
  const writes = { count: 0 };
  const registerTools = (server: Parameters<typeof registerScopedTool>[0]) =>
    registerScopedTool(server, 'write_probe', 'write', {}, async () => {
      writes.count += 1;
      return { content: [{ type: 'text', text: 'write' }] };
    });
  const app = express();
  app.use(express.json());
  registerMcpRoute(app, {} as never, true, {
    accessTokenModel: AccessToken,
    frontendOrigin: 'http://localhost:8000',
    trustedHosts: ['127.0.0.1'],
    now: () => now,
    registerTools,
    rateLimit: { max: 100 },
  });
  return { app, writes };
}
function post(
  app: express.Application,
  secret?: string,
  body = initialize,
  options: { authorization?: string; origin?: string; query?: Record<string, string> } = {}
) {
  const req = request(app).post('/mcp').set('Host', '127.0.0.1').set('Accept', 'application/json, text/event-stream');
  if (secret) req.set('Authorization', `Bearer ${secret}`);
  if (options.authorization) req.set('Authorization', options.authorization);
  if (options.origin) req.set('Origin', options.origin);
  if (options.query) req.query(options.query);
  return req.send(body);
}
describe('MCP transport authorization and guards', () => {
  it('rejects missing, malformed, query, expired, and revoked credentials before dispatch', async () => {
    const cases = [
      { secret: undefined, stored: 'valid', options: {} },
      { secret: undefined, stored: 'valid', options: { authorization: 'Basic invalid' } },
      { secret: 'valid', stored: 'valid', options: { query: { access_token: 'valid' } } },
      { secret: 'invalid', stored: 'invalid', values: { expiresAt: new Date(now.getTime() - 1) }, options: {} },
      { secret: 'invalid', stored: 'invalid', values: { revokedAt: now }, options: {} },
    ];
    for (const { secret, stored, values, options } of cases) {
      const { app, writes } = appFor({ token: token(stored, values) });
      expect((await post(app, secret, initialize, options)).status).toBe(401);
      expect(writes.count).toBe(0);
    }
  });
  it('rejects untrusted Host and Origin before dispatch', async () => {
    const { app, writes } = appFor({ valid: token('valid') });
    const host = await request(app)
      .post('/mcp')
      .set({ Host: 'evil.example', Authorization: 'Bearer valid' })
      .send(initialize);
    const origin = await post(app, 'valid', initialize, { origin: 'https://evil.example' });
    expect(host.status).toBe(403);
    expect(origin.status).toBe(403);
    expect(writes.count).toBe(0);
  });
  it('denies read-only writes without invoking the tool', async () => {
    const { app, writes } = appFor({ readOnly: token('read-only', { scopes: ['read'] }) });
    const body = { jsonrpc: '2.0', id: 2, method: 'tools/call', params: { name: 'write_probe', arguments: {} } };
    const response = await post(app, 'read-only', body);
    expect(response.status).toBe(200);
    expect(response.body.result.isError).toBe(true);
    expect(response.body.result.content[0].text).toContain('write');
    expect(writes.count).toBe(0);
  });
  it('returns a stable invalid-request error without dispatch', async () => {
    const { app, writes } = appFor({ valid: token('valid') });
    const response = await post(app, 'valid', {});
    expect(response.status).toBe(400);
    expect(response.body.error).toEqual(expect.objectContaining({ code: -32700 }));
    expect(writes.count).toBe(0);
  });
  it('limits each token independently at request 101', async () => {
    const { app } = appFor({ first: token('first'), second: token('second', { id: 2 }) });
    for (const id of Array.from({ length: 100 }, (_, index) => index + 1))
      expect((await post(app, 'first', { jsonrpc: '2.0', id, method: 'ping' })).status).toBe(200);
    expect((await post(app, 'first', { jsonrpc: '2.0', id: 101, method: 'ping' })).status).toBe(429);
    expect((await post(app, 'second', { jsonrpc: '2.0', id: 1, method: 'ping' })).status).toBe(200);
  });
});
