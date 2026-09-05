import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Sequelize } from 'sequelize';
import { ensureSuperuser } from './superuser.js';

const mockUser = {
  findOne: vi.fn(),
  create: vi.fn(),
};

vi.mock('./models/users.js', () => ({
  default: () => mockUser,
}));

vi.mock('bcrypt', () => ({
  default: { hash: vi.fn(async () => 'hashed-bootstrap-password') },
}));

describe('configured superuser bootstrap', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('creates a missing administrator with the email local-part and a bcrypt hash', async () => {
    mockUser.findOne.mockResolvedValue(null);
    mockUser.create.mockResolvedValue({});

    await ensureSuperuser({} as Sequelize, {
      SUPERUSER_EMAIL: 'admin@example.com',
      SUPERUSER_PASSWORD: 'bootstrap-password',
    });

    expect(mockUser.create).toHaveBeenCalledWith({
      email: 'admin@example.com',
      password: 'hashed-bootstrap-password',
      username: 'admin',
      role: 0,
    });
  });

  it('promotes an existing account without changing its password', async () => {
    const existingUser = { role: 1, update: vi.fn() };
    mockUser.findOne.mockResolvedValue(existingUser);

    await ensureSuperuser({} as Sequelize, {
      SUPERUSER_EMAIL: 'admin@example.com',
      SUPERUSER_PASSWORD: 'unused-password',
    });

    expect(existingUser.update).toHaveBeenCalledWith({ role: 0 });
    expect(mockUser.create).not.toHaveBeenCalled();
  });

  it('fails without a password only when the configured account is missing', async () => {
    mockUser.findOne.mockResolvedValue(null);

    await expect(
      ensureSuperuser({} as Sequelize, {
        SUPERUSER_EMAIL: 'admin@example.com',
      })
    ).rejects.toThrow('SUPERUSER_PASSWORD is required');
  });
});
