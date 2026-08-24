import { describe, expect, it, vi } from 'vitest';
import { DataTypes, Sequelize } from 'sequelize';
import defineCase from '../models/cases.js';
import defineAutomationDefinition from '../models/automationDefinitions.js';
import defineAutomationExecution from '../models/automationExecutions.js';
import defineExecutionArtifact from '../models/executionArtifacts.js';
import defineTestEnvironment from '../models/testEnvironments.js';
import { up } from '../migrations/20260823000001-create-automation.js';

describe('automation persistence contract', () => {
  it('stores versioned snapshots, attempts, private artifact metadata, and secret references only', () => {
    const sequelize = new Sequelize({ dialect: 'sqlite', logging: false });
    const Case = defineCase(sequelize, DataTypes);
    const Definition = defineAutomationDefinition(sequelize, DataTypes);
    const Execution = defineAutomationExecution(sequelize, DataTypes);
    const Artifact = defineExecutionArtifact(sequelize, DataTypes);
    const Environment = defineTestEnvironment(sequelize, DataTypes);

    expect(Case.rawAttributes.automationVersion.defaultValue).toBe(1);
    expect(Definition.rawAttributes.snapshotHash.allowNull).toBe(false);
    expect(Execution.rawAttributes.attempt.defaultValue).toBe(1);
    expect(Execution.rawAttributes.runCaseId.allowNull).toBe(true);
    expect(Artifact.rawAttributes.storageKey.allowNull).toBe(false);
    expect(Environment.rawAttributes.secretRefs.type.toString()).toContain('TEXT');
  });

  it('uses forward-only tables and a reversible case revision column', async () => {
    const query = {
      addColumn: vi.fn(),
      createTable: vi.fn(),
      addIndex: vi.fn(),
      dropTable: vi.fn(),
      removeColumn: vi.fn(),
    };
    await up(query, DataTypes);

    expect(query.addColumn).toHaveBeenCalledWith('cases', 'automationVersion', expect.any(Object));
    expect(query.createTable.mock.calls.map(([name]) => name)).toEqual([
      'testEnvironments',
      'automationDefinitions',
      'automationExecutions',
      'executionArtifacts',
    ]);
    expect(query.createTable).not.toHaveBeenCalledWith('public/uploads', expect.anything());
  });
});
