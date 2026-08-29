import { describe, expect, it, vi } from 'vitest';
import { DataTypes, Sequelize } from 'sequelize';
import defineCase from '../models/cases.js';
import defineAutomationDefinition from '../models/automationDefinitions.js';
import defineAutomationExecution from '../models/automationExecutions.js';
import defineExecutionArtifact from '../models/executionArtifacts.js';
import defineTestEnvironment from '../models/testEnvironments.js';
import { up } from '../migrations/20260823000001-create-automation.js';
import { up as addDefaultEnvironment } from '../migrations/20260824000000-add-default-to-test-environments.js';
import { up as addWorkerMetadata } from '../migrations/20260824000001-add-worker-execution-metadata.js';
import { up as addGherkinExamples } from '../migrations/20260825000000-add-gherkin-examples-to-cases.js';
import { up as addVideoCapture } from '../migrations/20260826000000-add-automation-video-capture.js';
import { up as addExampleIndex } from '../migrations/20260827000000-add-example-index-to-automation-executions.js';

describe('automation persistence contract', () => {
  it('stores versioned snapshots, attempts, private artifact metadata, and secret references only', () => {
    const sequelize = new Sequelize({ dialect: 'sqlite', logging: false });
    const Case = defineCase(sequelize, DataTypes);
    const Definition = defineAutomationDefinition(sequelize, DataTypes);
    const Execution = defineAutomationExecution(sequelize, DataTypes);
    const Artifact = defineExecutionArtifact(sequelize, DataTypes);
    const Environment = defineTestEnvironment(sequelize, DataTypes);

    expect(Case.rawAttributes.automationVersion.defaultValue).toBe(1);
    expect(Case.rawAttributes.gherkinExamples.allowNull).toBe(true);
    expect(Case.rawAttributes.gherkinExamples.type.toString()).toContain('TEXT');
    const outline = Case.build({ gherkinExamples: { headers: ['user'], rows: [['Ada']] } });
    expect(outline.getDataValue('gherkinExamples')).toBe('{"headers":["user"],"rows":[["Ada"]]}');
    expect(outline.get('gherkinExamples')).toEqual({ headers: ['user'], rows: [['Ada']] });
    expect(Definition.rawAttributes.snapshotHash.allowNull).toBe(false);
    expect(Execution.rawAttributes.attempt.defaultValue).toBe(1);
    expect(Execution.rawAttributes.attemptHistory.defaultValue).toBe('[]');
    expect(Execution.rawAttributes.lastWorkerEvent.allowNull).toBe(true);
    expect(Execution.rawAttributes.runCaseId.allowNull).toBe(true);
    expect(Execution.rawAttributes.exampleIndex.allowNull).toBe(true);
    expect(Artifact.rawAttributes.storageKey.allowNull).toBe(false);
    expect(Environment.rawAttributes.secretRefs.type.toString()).toContain('TEXT');
    expect(Environment.rawAttributes.isDefault.defaultValue).toBe(false);
    expect(Environment.rawAttributes.captureVideo.defaultValue).toBe(false);
    expect(Execution.rawAttributes.captureVideo.defaultValue).toBe(false);
    const environment = Environment.build({
      allowedHosts: ['example.test'],
      secretRefs: ['secret://token'],
    });
    expect(environment.getDataValue('allowedHosts')).toBe('["example.test"]');
    expect(environment.get('allowedHosts')).toEqual(['example.test']);
    expect(environment.get('secretRefs')).toEqual(['secret://token']);
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

  it('adds one project-scoped default environment without exposing secret fields', async () => {
    const query = { addColumn: vi.fn(), addIndex: vi.fn() };
    await addDefaultEnvironment(query, DataTypes);
    expect(query.addColumn).toHaveBeenCalledWith('testEnvironments', 'isDefault', expect.any(Object));
    expect(query.addIndex).toHaveBeenCalledWith(
      'testEnvironments',
      ['projectId'],
      expect.objectContaining({ unique: true, where: { isDefault: true } })
    );
  });

  it('adds replay-safe worker attempt metadata without changing the secret boundary', async () => {
    const query = { addColumn: vi.fn(), removeColumn: vi.fn() };
    await addWorkerMetadata(query, DataTypes);
    expect(query.addColumn).toHaveBeenCalledWith('automationExecutions', 'attemptHistory', expect.any(Object));
    expect(query.addColumn).toHaveBeenCalledWith('automationExecutions', 'lastWorkerEvent', expect.any(Object));
    expect(query.removeColumn).toHaveBeenCalledTimes(0);
  });

  it('adds nullable Scenario Outline examples without changing existing cases', async () => {
    const query = { addColumn: vi.fn() };
    await addGherkinExamples(query, DataTypes);
    expect(query.addColumn).toHaveBeenCalledWith(
      'cases',
      'gherkinExamples',
      expect.objectContaining({ allowNull: true, defaultValue: null })
    );
  });

  it('adds conservative video capture flags to environments and executions', async () => {
    const query = { addColumn: vi.fn(), removeColumn: vi.fn() };
    await addVideoCapture(query, DataTypes);
    expect(query.addColumn).toHaveBeenCalledWith(
      'testEnvironments',
      'captureVideo',
      expect.objectContaining({ defaultValue: false })
    );
    expect(query.addColumn).toHaveBeenCalledWith(
      'automationExecutions',
      'captureVideo',
      expect.objectContaining({ defaultValue: false })
    );
  });

  it('adds a nullable example row index without changing existing executions', async () => {
    const query = { addColumn: vi.fn(), removeColumn: vi.fn() };
    await addExampleIndex(query, DataTypes);
    expect(query.addColumn).toHaveBeenCalledWith(
      'automationExecutions',
      'exampleIndex',
      expect.objectContaining({ allowNull: true })
    );
  });
});
