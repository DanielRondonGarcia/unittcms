import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import request from 'supertest';
import express from 'express';
import jwt from 'jsonwebtoken';
import accessTokensRoute from './accessTokens.js';

const TEST_SECRET = 'access-token-route-test-secret';
const mockAccessToken = {
  create: vi.fn(),
  findAll: vi.fn(),
  findOne: vi.fn(),
};

vi.mock('../../models/accessTokens.js', () => ({
  default: () => mockAccessToken,
}));

function makeApp() {
  const app = express();
  app.use(express.json());
  app.use('/users', accessTokensRoute({}));
  return app;
}

function authHeader(userId = 1) {
  return `Bearer ${jwt.sign({ userId }, TEST_SECRET)}`;
}

function tokenRecord(overrides = {}) {
  const values = {
    id: 7,
    userId: 1,
    name: 'Automation client',
    tokenPrefix: 'qwertyui',
    tokenHash: 'a'.repeat(64),
    scopes: ['read'],
    expiresAt: new Date('2030-01-01T00:00:00.000Z'),
    revokedAt: null,
    lastUsedAt: null,
    createdAt: new Date('2029-01-01T00:00:00.000Z'),
    updatedAt: new Date('2029-01-01T00:00:00.000Z'),
    ...overrides,
  };
  return {
    ...values,
    toJSON: () => ({ ...values }),
    update: vi.fn(async (changes) => Object.assign(values, changes)),
  };
}

describe('access-token API', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.stubEnv('SECRET_KEY', TEST_SECRET);
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it('rejects missing or malformed JWT bearer credentials before creating a token', async () => {
    const app = makeApp();

    const missing = await request(app)
      .post('/users/access-tokens')
      .send({ scopes: ['read'] });
    const malformed = await request(app)
      .post('/users/access-tokens')
      .set('Authorization', 'Bearer not-a-jwt')
      .send({ scopes: ['read'] });

    expect(missing.status).toBe(401);
    expect(malformed.status).toBe(401);
    expect(mockAccessToken.create).not.toHaveBeenCalled();
  });

  it('does not accept a query-string credential as a substitute for the JWT bearer header', async () => {
    const response = await request(makeApp())
      .post('/users/access-tokens?token=valid-but-not-a-header-credential')
      .send({ scopes: ['read'] });

    expect(response.status).toBe(401);
    expect(mockAccessToken.create).not.toHaveBeenCalled();
  });

  it('creates a read/write token with a one-time 32-byte base64url secret and hashed storage', async () => {
    mockAccessToken.create.mockImplementation(async (values) => tokenRecord(values));

    const response = await request(makeApp())
      .post('/users/access-tokens')
      .set('Authorization', authHeader(42))
      .send({ name: 'CI', scopes: ['write', 'read'], expiresInDays: 30 });

    expect(response.status).toBe(201);
    expect(response.body).toMatchObject({ name: 'CI', scopes: ['read', 'write'] });
    expect(response.body.secret).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(Buffer.from(response.body.secret, 'base64url')).toHaveLength(32);
    expect(response.body).not.toHaveProperty('tokenHash');

    const stored = mockAccessToken.create.mock.calls[0][0];
    expect(stored.userId).toBe(42);
    expect(stored.tokenHash).toMatch(/^[a-f0-9]{64}$/);
    expect(stored.tokenPrefix).toBe(response.body.secret.slice(0, 8));
    expect(stored.scopes).toEqual(['read', 'write']);
  });

  it('validates scopes and expiry limits before persistence', async () => {
    const response = await request(makeApp())
      .post('/users/access-tokens')
      .set('Authorization', authHeader())
      .send({ scopes: ['write'], expiresInDays: 91 });

    expect(response.status).toBe(400);
    expect(response.body.error).toBe('Invalid access-token settings');
    expect(mockAccessToken.create).not.toHaveBeenCalled();
  });

  it('lists only owned metadata and never returns the secret or hash', async () => {
    mockAccessToken.findAll.mockResolvedValue([tokenRecord({ userId: 42 })]);

    const response = await request(makeApp()).get('/users/access-tokens').set('Authorization', authHeader(42));

    expect(response.status).toBe(200);
    expect(mockAccessToken.findAll).toHaveBeenCalledWith({
      where: { userId: 42 },
      order: [['createdAt', 'DESC']],
    });
    expect(response.body).toHaveLength(1);
    expect(response.body[0]).toMatchObject({ id: 7, tokenPrefix: 'qwertyui', scopes: ['read'] });
    expect(response.body[0]).not.toHaveProperty('secret');
    expect(response.body[0]).not.toHaveProperty('tokenHash');
  });

  it('revokes only an owned token and does not return a secret', async () => {
    const token = tokenRecord({ userId: 42 });
    mockAccessToken.findOne.mockResolvedValue(token);

    const response = await request(makeApp()).delete('/users/access-tokens/7').set('Authorization', authHeader(42));

    expect(response.status).toBe(204);
    expect(response.text).toBe('');
    expect(token.update).toHaveBeenCalledWith({ revokedAt: expect.any(Date) });
    expect(mockAccessToken.findOne).toHaveBeenCalledWith({ where: { id: 7, userId: 42 } });
  });

  it('hides tokens owned by another user when revoking', async () => {
    mockAccessToken.findOne.mockResolvedValue(null);

    const response = await request(makeApp()).delete('/users/access-tokens/7').set('Authorization', authHeader(42));

    expect(response.status).toBe(404);
    expect(response.body).toEqual({ error: 'Access token not found' });
  });
});
