import { describe, expect, it, vi } from 'vitest';
import { up } from '../../migrations/20260828000000-add-active-execution-key.js';

describe('active execution key migration', () => {
  it('keeps one deterministic key and clears duplicate legacy keys before adding uniqueness', async () => {
    const bulkUpdate = vi.fn(async () => undefined);
    const queryInterface = {
      addColumn: vi.fn(async () => undefined),
      sequelize: {
        query: vi.fn(async () => [
          [
            { id: 13, runCaseId: 7, exampleIndex: 1 },
            { id: 12, runCaseId: 7, exampleIndex: 1 },
            { id: 14, runCaseId: 7, exampleIndex: null },
          ],
        ]),
      },
      bulkUpdate,
      addIndex: vi.fn(async () => undefined),
    };

    await up(queryInterface, { STRING: 'STRING' });

    expect(bulkUpdate).toHaveBeenNthCalledWith(1, 'automationExecutions', { activeExecutionKey: '7:1' }, { id: 12 });
    expect(bulkUpdate).toHaveBeenNthCalledWith(2, 'automationExecutions', { activeExecutionKey: null }, { id: 13 });
    expect(bulkUpdate).toHaveBeenNthCalledWith(3, 'automationExecutions', { activeExecutionKey: '7:scenario' }, { id: 14 });
  });
});
