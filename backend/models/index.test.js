import { describe, expect, it, vi } from 'vitest';

vi.mock('sequelize', () => {
  const DataTypes = new Proxy(
    {},
    {
      get: () => function DataType() {},
    }
  );
  class MockSequelize {
    static DataTypes = DataTypes;

    constructor(...args) {
      const options = args.at(-1);
      this.options = { ...options };
      this.dialect = {
        connectionManager: {
          connection: { configure: vi.fn() },
          getConnection: vi.fn(async function (...args) {
            this.lastThis = this;
            this.lastArguments = args;
            if (this.error) throw this.error;
            return this.connection;
          }),
        },
      };
    }

    define(name) {
      return {
        name,
        belongsTo: () => undefined,
        belongsToMany: () => undefined,
        hasMany: () => undefined,
      };
    }
  }

  return { default: MockSequelize };
});

const db = (await import('./index.js')).default;

describe('SQLite model connection', () => {
  const connectionManager = db.sequelize.dialect.connectionManager;

  it('configures every effective SQLite connection once while forwarding the call unchanged', async () => {
    const firstConnection = { configure: vi.fn() };
    const secondConnection = { configure: vi.fn() };
    const firstOptions = { type: 'write' };
    const secondOptions = { type: 'read' };

    connectionManager.connection = firstConnection;
    await expect(connectionManager.getConnection(firstOptions, 'extra')).resolves.toBe(firstConnection);

    expect(connectionManager.lastThis).toBe(connectionManager);
    expect(connectionManager.lastArguments).toEqual([firstOptions, 'extra']);
    expect(firstConnection.configure).toHaveBeenCalledOnce();
    expect(firstConnection.configure).toHaveBeenCalledWith('busyTimeout', 5_000);

    await expect(connectionManager.getConnection(firstOptions)).resolves.toBe(firstConnection);
    expect(firstConnection.configure).toHaveBeenCalledOnce();

    connectionManager.connection = secondConnection;
    await expect(connectionManager.getConnection(secondOptions)).resolves.toBe(secondConnection);
    expect(secondConnection.configure).toHaveBeenCalledOnce();
    expect(secondConnection.configure).toHaveBeenCalledWith('busyTimeout', 5_000);
  });

  it('preserves the original getConnection error', async () => {
    const error = new Error('connection failed');
    connectionManager.error = error;

    await expect(connectionManager.getConnection({ type: 'write' })).rejects.toBe(error);

    connectionManager.error = undefined;
  });
});
