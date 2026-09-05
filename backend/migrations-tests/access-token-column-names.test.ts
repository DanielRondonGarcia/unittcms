import { describe, expect, it, vi } from 'vitest';
import { down, up } from '../migrations/20260905010000-fix-access-token-column-names.js';

const camelCaseColumns = {
  userId: {},
  tokenPrefix: {},
  tokenHash: {},
  expiresAt: {},
  revokedAt: {},
  lastUsedAt: {},
  createdAt: {},
  updatedAt: {},
};

const snakeCaseColumns = {
  user_id: {},
  token_prefix: {},
  token_hash: {},
  expires_at: {},
  revoked_at: {},
  last_used_at: {},
  created_at: {},
  updated_at: {},
};

function queryInterface(columns: Record<string, object>, index = true) {
  return {
    describeTable: vi.fn().mockResolvedValue(columns),
    showIndex: vi.fn().mockResolvedValue(index ? [{ name: 'access_tokens_user_created_at' }] : []),
    removeIndex: vi.fn(),
    renameColumn: vi.fn(),
    addIndex: vi.fn(),
  };
}

describe('access-token column-name migration', () => {
  it('renames the original camel-case columns and recreates the ownership index', async () => {
    const query = queryInterface(camelCaseColumns);

    await up(query);

    expect(query.removeIndex).toHaveBeenCalledWith('access_tokens', 'access_tokens_user_created_at');
    expect(query.renameColumn).toHaveBeenCalledWith('access_tokens', 'userId', 'user_id');
    expect(query.renameColumn).toHaveBeenCalledWith('access_tokens', 'updatedAt', 'updated_at');
    expect(query.addIndex).toHaveBeenCalledWith('access_tokens', ['user_id', 'created_at'], {
      name: 'access_tokens_user_created_at',
    });
  });

  it('reverses the rename and index on rollback', async () => {
    const query = queryInterface(snakeCaseColumns);

    await down(query);

    expect(query.renameColumn).toHaveBeenCalledWith('access_tokens', 'user_id', 'userId');
    expect(query.renameColumn).toHaveBeenCalledWith('access_tokens', 'updated_at', 'updatedAt');
    expect(query.addIndex).toHaveBeenCalledWith('access_tokens', ['userId', 'createdAt'], {
      name: 'access_tokens_user_created_at',
    });
  });
});
