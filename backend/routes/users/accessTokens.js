import crypto from 'node:crypto';
import express from 'express';
import { DataTypes } from 'sequelize';
import defineAccessToken from '../../models/accessTokens.js';
import authMiddleware from '../../middleware/auth.js';

const DEFAULT_EXPIRY_DAYS = 30;
const MAX_EXPIRY_DAYS = 90;
const TOKEN_PREFIX_LENGTH = 8;
const ALLOWED_SCOPES = new Set(['read', 'write']);

function normalizeScopes(value) {
  if (!Array.isArray(value) || value.length === 0 || value.some((scope) => typeof scope !== 'string')) return null;
  const scopes = [...new Set(value)];
  if (scopes.some((scope) => !ALLOWED_SCOPES.has(scope))) return null;
  if (scopes.length === 1 && scopes[0] === 'read') return ['read'];
  if (scopes.length === 2 && scopes.includes('read') && scopes.includes('write')) return ['read', 'write'];
  return null;
}

function normalizeExpiryDays(value) {
  const days = value === undefined ? DEFAULT_EXPIRY_DAYS : value;
  return Number.isInteger(days) && days >= 1 && days <= MAX_EXPIRY_DAYS ? days : null;
}

function normalizeName(value) {
  if (value === undefined || value === null || value === '') return null;
  if (typeof value !== 'string') return null;
  const name = value.trim();
  return name.length <= 100 && !/[\u0000-\u001f\u007f]/.test(name) ? name || null : null;
}

function plainToken(token) {
  if (typeof token?.get === 'function') return token.get({ plain: true });
  if (typeof token?.toJSON === 'function') return token.toJSON();
  return token;
}

function responseMetadata(token) {
  const values = plainToken(token);
  let scopes = values.scopes;
  if (typeof scopes === 'string') {
    try {
      scopes = JSON.parse(scopes);
    } catch {
      scopes = [];
    }
  }
  return {
    id: values.id,
    name: values.name,
    tokenPrefix: values.tokenPrefix,
    scopes,
    expiresAt: values.expiresAt,
    revokedAt: values.revokedAt,
    lastUsedAt: values.lastUsedAt,
    createdAt: values.createdAt,
  };
}

function invalidSettings(res) {
  return res.status(400).json({ error: 'Invalid access-token settings' });
}

export default function accessTokensRoute(sequelize) {
  const router = express.Router();
  const { verifySignedIn } = authMiddleware(sequelize);
  const AccessToken = defineAccessToken(sequelize, DataTypes);

  router.post('/access-tokens', verifySignedIn, async (req, res) => {
    const scopes = normalizeScopes(req.body?.scopes);
    const expiresInDays = normalizeExpiryDays(req.body?.expiresInDays);
    const name = normalizeName(req.body?.name);
    if (!scopes || expiresInDays === null || (req.body?.name !== undefined && name === null))
      return invalidSettings(res);

    const secret = crypto.randomBytes(32).toString('base64url');
    const now = new Date();
    const expiresAt = new Date(now.getTime() + expiresInDays * 24 * 60 * 60 * 1000);
    try {
      const token = await AccessToken.create({
        userId: req.userId,
        name,
        tokenPrefix: secret.slice(0, TOKEN_PREFIX_LENGTH),
        tokenHash: crypto.createHash('sha256').update(secret).digest('hex'),
        scopes,
        expiresAt,
        revokedAt: null,
        lastUsedAt: null,
      });
      return res.status(201).json({ ...responseMetadata(token), secret });
    } catch (error) {
      console.error('Access-token creation failed:', error);
      return res.status(500).json({ error: 'Internal Server Error' });
    }
  });

  router.get('/access-tokens', verifySignedIn, async (req, res) => {
    try {
      const tokens = await AccessToken.findAll({
        where: { userId: req.userId },
        order: [['createdAt', 'DESC']],
      });
      return res.json(tokens.map(responseMetadata));
    } catch (error) {
      console.error('Access-token listing failed:', error);
      return res.status(500).json({ error: 'Internal Server Error' });
    }
  });

  router.delete('/access-tokens/:id', verifySignedIn, async (req, res) => {
    const id = Number(req.params.id);
    if (!Number.isInteger(id) || id <= 0) return res.status(400).json({ error: 'Invalid access-token id' });

    try {
      const token = await AccessToken.findOne({ where: { id, userId: req.userId } });
      if (!token) return res.status(404).json({ error: 'Access token not found' });
      await token.update({ revokedAt: new Date() });
      return res.status(204).send();
    } catch (error) {
      console.error('Access-token revocation failed:', error);
      return res.status(500).json({ error: 'Internal Server Error' });
    }
  });

  return router;
}
