import path from 'path';
import { defaultDangerKey } from '../routes/users/authSettings.js';

export const FRONTEND_ORIGIN = process.env.FRONTEND_ORIGIN || 'http://localhost:8000';
export const SECRET_KEY = process.env.SECRET_KEY || defaultDangerKey;

export const IS_PROD = process.env.NODE_ENV === 'production';
export const PORT = process.env.PORT || 8001;
export const API_PATH = process.env.API_PATH || '/api';

const FALSE_LIKE_VALUES = new Set(['false', '0', 'no', 'off']);
const DEFAULT_MCP_RATE_LIMIT_MAX = 100;
const DEFAULT_MCP_RATE_LIMIT_WINDOW_MS = 60 * 60 * 1000;

export function isFalseLike(value) {
  return typeof value === 'string' && FALSE_LIKE_VALUES.has(value.trim().toLowerCase());
}

export function isManualExecutionEnabled(value = process.env.MANUAL_EXECUTION_ENABLED) {
  return !isFalseLike(value);
}

export function isRateLimitEnabled(value = process.env.RATE_LIMIT_ENABLED) {
  return !isFalseLike(value);
}

export function isMcpRateLimitEnabled(value = process.env.MCP_RATE_LIMIT_ENABLED) {
  return !isFalseLike(value);
}

function parsePositiveInteger(value, fallback) {
  if (typeof value === 'number') {
    return Number.isSafeInteger(value) && value > 0 ? value : fallback;
  }

  if (typeof value !== 'string') return fallback;
  const normalized = value.trim();
  if (!/^\d+$/.test(normalized)) return fallback;

  const parsed = Number(normalized);
  return Number.isSafeInteger(parsed) && parsed > 0 ? parsed : fallback;
}

export function parseMcpRateLimitMax(value = process.env.MCP_RATE_LIMIT_MAX) {
  return parsePositiveInteger(value, DEFAULT_MCP_RATE_LIMIT_MAX);
}

export function parseMcpRateLimitWindowMs(value = process.env.MCP_RATE_LIMIT_WINDOW_MS) {
  return parsePositiveInteger(value, DEFAULT_MCP_RATE_LIMIT_WINDOW_MS);
}

export function isSelfRegistrationEnabled(value = process.env.ALLOW_SELF_REGISTRATION) {
  return !isFalseLike(value);
}

export function isSuperuserConfigured(value = process.env.SUPERUSER_EMAIL) {
  return typeof value === 'string' && value.trim().length > 0;
}

export const MANUAL_EXECUTION_ENABLED = isManualExecutionEnabled();
export const RATE_LIMIT_ENABLED = isRateLimitEnabled();
export const ALLOW_SELF_REGISTRATION = isSelfRegistrationEnabled();

export function isMcpEnabled(value = process.env.MCP_ENABLED) {
  return typeof value === 'string' && value.trim().length > 0 && !isFalseLike(value);
}

export function parseMcpTrustedHosts(value = process.env.MCP_TRUSTED_HOSTS) {
  if (typeof value !== 'string') return [];
  return [
    ...new Set(
      value
        .split(',')
        .map((host) => host.trim())
        .filter(Boolean)
    ),
  ];
}

export const MCP_ENABLED = isMcpEnabled();
export const MCP_TRUSTED_HOSTS = parseMcpTrustedHosts();
export const MCP_RATE_LIMIT_ENABLED = isMcpRateLimitEnabled();
export const MCP_RATE_LIMIT_MAX = parseMcpRateLimitMax();
export const MCP_RATE_LIMIT_WINDOW_MS = parseMcpRateLimitWindowMs();

export function registerManualExecutionRoute(app, sequelize, routeFactory, enabled = MANUAL_EXECUTION_ENABLED) {
  if (enabled) app.use('/manual-executions', routeFactory(sequelize));
}

const databasePath = process.env.DATABASE_PATH ?? path.resolve(process.cwd(), 'database/database.sqlite');

export default {
  development: {
    dialect: 'sqlite',
    storage: databasePath,
  },
  test: {
    dialect: 'sqlite',
    storage: databasePath,
  },
  production: {
    dialect: 'sqlite',
    storage: databasePath,
  },
};
