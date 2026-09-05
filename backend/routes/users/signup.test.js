import express from 'express';
import request from 'supertest';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import signupRoute from './signup.js';

const mocks = vi.hoisted(() => ({
  hash: vi.fn(),
  user: {
    count: vi.fn(),
    create: vi.fn(),
  },
}));

vi.mock('bcrypt', () => ({ default: { hash: mocks.hash } }));
vi.mock('../../models/users.js', () => ({ default: () => mocks.user }));

describe('self-registration policy', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.unstubAllEnvs();
  });

  it('returns the runtime policy without authentication', async () => {
    vi.stubEnv('ALLOW_SELF_REGISTRATION', 'off');
    const app = express();
    app.use('/users', signupRoute({}));

    const response = await request(app).get('/users/registration-enabled');

    expect(response.status).toBe(200);
    expect(response.body).toEqual({ enabled: false });
  });

  it('fails closed before hashing or creating a local user', async () => {
    vi.stubEnv('ALLOW_SELF_REGISTRATION', '0');
    const app = express();
    app.use(express.json());
    app.use('/users', signupRoute({}));

    const response = await request(app).post('/users/signup').send({
      email: 'new@example.com',
      password: 'test-password',
      username: 'new-user',
    });

    expect(response.status).toBe(403);
    expect(response.body).toEqual({ code: 'self_registration_disabled', error: 'self_registration_disabled' });
    expect(mocks.hash).not.toHaveBeenCalled();
    expect(mocks.user.count).not.toHaveBeenCalled();
    expect(mocks.user.create).not.toHaveBeenCalled();
  });
});
