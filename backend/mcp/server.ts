import express, { type Application, type ErrorRequestHandler } from 'express';
import RateLimit from 'express-rate-limit';
import { DataTypes } from 'sequelize';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import { FRONTEND_ORIGIN, MCP_TRUSTED_HOSTS } from '../config/config.js';
import defineAccessToken from '../models/accessTokens.js';
import { createMcpAuthMiddleware, createMcpGuardMiddleware, type AccessTokenModel } from './auth.js';
import { registerMcpOperations, registerScopedTool } from './operations.js';
export { registerScopedTool };

type RouterOptions = {
  accessTokenModel?: AccessTokenModel;
  trustedHosts?: readonly string[];
  frontendOrigin?: string;
  now?: () => Date;
  registerTools?: (server: McpServer) => void;
  rateLimit?: { windowMs?: number; max?: number };
};
export function createMcpRouter(sequelize: any, options: RouterOptions = {}): express.Router {
  const AccessToken = options.accessTokenModel ?? (defineAccessToken(sequelize, DataTypes) as AccessTokenModel);
  const router = express.Router();
  router.use(
    createMcpGuardMiddleware({
      trustedHosts: options.trustedHosts ?? MCP_TRUSTED_HOSTS,
      frontendOrigin: options.frontendOrigin ?? FRONTEND_ORIGIN,
    })
  );
  router.use(createMcpAuthMiddleware({ accessTokenModel: AccessToken, now: options.now }));
  router.use(
    RateLimit({
      windowMs: options.rateLimit?.windowMs ?? 60 * 60 * 1000,
      max: options.rateLimit?.max ?? 100,
      keyGenerator: (req) =>
        String((req as typeof req & { auth?: { extra?: { tokenId?: number } } }).auth?.extra?.tokenId),
      standardHeaders: 'draft-7',
      legacyHeaders: false,
      message: { error: 'MCP rate limit exceeded' },
    })
  );
  router.all('/', async (req, res, next) => {
    const server = new McpServer({ name: 'unittcms', version: '1.0.0' });
    (options.registerTools ?? ((mcp) => registerMcpOperations(mcp, sequelize)))(server);
    const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined, enableJsonResponse: true });
    try {
      await server.connect(transport);
      await transport.handleRequest(req, res, req.body);
    } catch (error) {
      if (!res.headersSent) next(error);
    } finally {
      await server.close().catch(() => undefined);
    }
  });
  return router;
}
const mcpErrorHandler: ErrorRequestHandler = (error, _req, res, next) => {
  if (res.headersSent) return next(error);
  const parseError = error?.type === 'entity.parse.failed';
  return res.status(parseError ? 400 : 500).json({
    jsonrpc: '2.0',
    error: { code: parseError ? -32700 : -32603, message: parseError ? 'Parse error' : 'Internal error' },
  });
};
export function registerMcpRoute(app: Application, sequelize: any, enabled: boolean, options?: RouterOptions): void {
  if (!enabled) return;
  app.use('/mcp', createMcpRouter(sequelize, options));
  app.use('/mcp', mcpErrorHandler);
}
