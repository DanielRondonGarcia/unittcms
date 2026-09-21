import { describe, expect, it, vi } from 'vitest';
import { down, up } from '../migrations/20260920200000-add-position-to-cases.js';

const Sequelize = { INTEGER: 'INTEGER' };

function queryInterface() {
  return {
    addColumn: vi.fn(async () => undefined),
    changeColumn: vi.fn(async () => undefined),
    addIndex: vi.fn(async () => undefined),
    removeIndex: vi.fn(async () => undefined),
    removeColumn: vi.fn(async () => undefined),
    sequelize: {
      query: vi.fn(async () => undefined),
    },
  };
}

describe('case position migration', () => {
  it('adds a nullable column, backfills position from immutable ids, then enforces the final shape', async () => {
    const query = queryInterface();

    await up(query, Sequelize);

    expect(query.addColumn).toHaveBeenCalledWith('cases', 'position', {
      type: 'INTEGER',
      allowNull: true,
      defaultValue: null,
    });
    expect(query.sequelize.query).toHaveBeenCalledWith('UPDATE "cases" SET "position" = "id" WHERE "position" IS NULL');
    expect(query.changeColumn).toHaveBeenCalledWith('cases', 'position', {
      type: 'INTEGER',
      allowNull: false,
    });
    expect(query.addIndex).toHaveBeenCalledWith('cases', ['folderId', 'position'], {
      unique: true,
      name: 'cases_folderId_position_unique',
    });
  });

  it('removes the position uniqueness contract and column on rollback', async () => {
    const query = queryInterface();

    await down(query);

    expect(query.removeIndex).toHaveBeenCalledWith('cases', 'cases_folderId_position_unique');
    expect(query.removeColumn).toHaveBeenCalledWith('cases', 'position');
    expect(query.removeIndex.mock.invocationCallOrder[0]).toBeLessThan(query.removeColumn.mock.invocationCallOrder[0]);
  });
});
