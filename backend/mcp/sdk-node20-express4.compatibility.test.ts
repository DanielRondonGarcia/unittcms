import crypto from 'node:crypto';
import { createRequire } from 'node:module';
import express from 'express';
import request from 'supertest';
import { describe, expect, it, vi } from 'vitest';
import { registerMcpRoute } from './server.js';

const require = createRequire(import.meta.url);
const expressVersion = require('express/package.json').version as string;
const now = new Date('2026-09-05T12:00:00.000Z');
const secret = 'node20-express4-compatibility-secret';
const initialize = {
  jsonrpc: '2.0',
  id: 1,
  method: 'initialize',
  params: { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 'compatibility-test', version: '1' } },
};

describe('Node 20 / Express 4 MCP SDK compatibility harness', () => {
  it('serves a stateless Streamable HTTP initialize response without external services', async () => {
    expect(Number(process.versions.node.split('.')[0])).toBeGreaterThanOrEqual(20);
    expect(expressVersion).toMatch(/^4\./);

    const token = {
      id: 31,
      userId: 7,
      tokenHash: crypto.createHash('sha256').update(secret).digest('hex'),
      scopes: ['read', 'write'],
      expiresAt: new Date(now.getTime() + 3600000),
      revokedAt: null,
      update: vi.fn(),
    };
    const accessTokenModel = {
      findOne: vi.fn(async ({ where }: { where: { tokenHash: string } }) =>
        where.tokenHash === token.tokenHash ? token : null
      ),
    };
    const app = express();
    app.use(express.json());
    registerMcpRoute(app, {} as never, true, {
      accessTokenModel,
      frontendOrigin: 'http://localhost:8000',
      trustedHosts: ['127.0.0.1'],
      now: () => now,
      registerTools: () => undefined,
    });

    const response = await request(app)
      .post('/mcp')
      .set({
        Host: '127.0.0.1',
        Authorization: `Bearer ${secret}`,
        Accept: 'application/json, text/event-stream',
      })
      .send(initialize);

    expect(response.status).toBe(200);
    expect(response.headers['mcp-session-id']).toBeUndefined();
    expect(response.body).toEqual(
      expect.objectContaining({
        jsonrpc: '2.0',
        id: 1,
        result: expect.objectContaining({
          protocolVersion: '2025-06-18',
          serverInfo: expect.objectContaining({ name: 'unittcms' }),
        }),
      })
    );
    expect(token.update).toHaveBeenCalledWith({ lastUsedAt: now });
  });
});
