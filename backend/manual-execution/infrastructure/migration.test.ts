import { describe, expect, it, vi } from 'vitest';
import { up } from '../../migrations/20260829000000-create-manual-executions.js';
import {
  down as removeReport,
  up as addReport,
} from '../../migrations/20260831000000-add-report-to-manual-executions.js';

describe('manual execution migration', () => {
  it('creates additive execution/evidence tables and a nullable unique active key', async () => {
    const queryInterface = {
      createTable: vi.fn(async () => undefined),
      addIndex: vi.fn(async () => undefined),
    };

    await up(queryInterface, {
      INTEGER: 'INTEGER',
      STRING: vi.fn((length?: number) => `STRING${length ?? ''}`),
      TEXT: 'TEXT',
      DATE: 'DATE',
      BOOLEAN: 'BOOLEAN',
    });

    expect(queryInterface.createTable).toHaveBeenNthCalledWith(
      1,
      'manualExecutions',
      expect.objectContaining({
        activeExecutionKey: expect.objectContaining({ allowNull: true }),
        runCaseId: expect.objectContaining({ allowNull: true }),
        caseSnapshotHash: expect.any(Object),
      })
    );
    expect(queryInterface.createTable).toHaveBeenNthCalledWith(
      2,
      'manualExecutionEvidences',
      expect.objectContaining({
        storageKey: expect.objectContaining({ unique: true }),
        expiresAt: expect.any(Object),
      })
    );
    expect(queryInterface.addIndex).toHaveBeenCalledWith('manualExecutions', ['activeExecutionKey'], {
      unique: true,
      name: 'manual_executions_active_key_unique',
    });
  });

  it('adds and removes a nullable report column without changing existing rows', async () => {
    const queryInterface = {
      addColumn: vi.fn(async () => undefined),
      removeColumn: vi.fn(async () => undefined),
    };

    await addReport(queryInterface, { TEXT: 'TEXT' });
    await removeReport(queryInterface);

    expect(queryInterface.addColumn).toHaveBeenCalledWith('manualExecutions', 'report', {
      type: 'TEXT',
      allowNull: true,
    });
    expect(queryInterface.removeColumn).toHaveBeenCalledWith('manualExecutions', 'report');
  });
});
