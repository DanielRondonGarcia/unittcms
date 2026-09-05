import path from 'path';
import { defaultDangerKey } from '../routes/users/authSettings.js';

export const FRONTEND_ORIGIN = process.env.FRONTEND_ORIGIN || 'http://localhost:8000';
export const SECRET_KEY = process.env.SECRET_KEY || defaultDangerKey;

export const IS_PROD = process.env.NODE_ENV === 'production';
export const PORT = process.env.PORT || 8001;
export const API_PATH = process.env.API_PATH || '/api';

const FALSE_LIKE_VALUES = new Set(['false', '0', 'no', 'off']);

export function isFalseLike(value) {
  return typeof value === 'string' && FALSE_LIKE_VALUES.has(value.trim().toLowerCase());
}

export function isManualExecutionEnabled(value = process.env.MANUAL_EXECUTION_ENABLED) {
  return !isFalseLike(value);
}

export function isSelfRegistrationEnabled(value = process.env.ALLOW_SELF_REGISTRATION) {
  return !isFalseLike(value);
}

export function isSuperuserConfigured(value = process.env.SUPERUSER_EMAIL) {
  return typeof value === 'string' && value.trim().length > 0;
}

export const MANUAL_EXECUTION_ENABLED = isManualExecutionEnabled();
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
