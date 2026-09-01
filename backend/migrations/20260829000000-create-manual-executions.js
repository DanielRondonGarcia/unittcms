export async function up(queryInterface, Sequelize) {
  await queryInterface.createTable('manualExecutions', {
    id: { type: Sequelize.INTEGER, primaryKey: true, autoIncrement: true },
    projectId: {
      type: Sequelize.INTEGER,
      allowNull: false,
      references: { model: 'projects', key: 'id' },
      onUpdate: 'CASCADE',
      onDelete: 'CASCADE',
    },
    runId: {
      type: Sequelize.INTEGER,
      allowNull: true,
      references: { model: 'runs', key: 'id' },
      onUpdate: 'CASCADE',
      onDelete: 'SET NULL',
    },
    runCaseId: {
      type: Sequelize.INTEGER,
      allowNull: true,
      references: { model: 'runCases', key: 'id' },
      onUpdate: 'CASCADE',
      onDelete: 'SET NULL',
    },
    caseId: {
      type: Sequelize.INTEGER,
      allowNull: true,
      references: { model: 'cases', key: 'id' },
      onUpdate: 'CASCADE',
      onDelete: 'SET NULL',
    },
    actorUserId: {
      type: Sequelize.INTEGER,
      allowNull: false,
      references: { model: 'users', key: 'id' },
      onUpdate: 'CASCADE',
      onDelete: 'RESTRICT',
    },
    assigneeUserId: {
      type: Sequelize.INTEGER,
      allowNull: true,
      references: { model: 'users', key: 'id' },
      onUpdate: 'CASCADE',
      onDelete: 'SET NULL',
    },
    status: { type: Sequelize.STRING, allowNull: false, defaultValue: 'running' },
    result: { type: Sequelize.STRING, allowNull: true },
    startedAt: { type: Sequelize.DATE, allowNull: false },
    finishedAt: { type: Sequelize.DATE, allowNull: true },
    caseRevision: { type: Sequelize.INTEGER, allowNull: false },
    caseSnapshot: { type: Sequelize.TEXT, allowNull: false },
    caseSnapshotHash: { type: Sequelize.STRING(64), allowNull: false },
    staleRevision: { type: Sequelize.BOOLEAN, allowNull: false, defaultValue: false },
    activeExecutionKey: { type: Sequelize.STRING, allowNull: true },
    correlationId: { type: Sequelize.STRING, allowNull: false },
    createdAt: { type: Sequelize.DATE, allowNull: false },
    updatedAt: { type: Sequelize.DATE, allowNull: false },
  });

  await queryInterface.addIndex('manualExecutions', ['activeExecutionKey'], {
    unique: true,
    name: 'manual_executions_active_key_unique',
  });
  await queryInterface.addIndex('manualExecutions', ['projectId', 'actorUserId'], {
    name: 'manual_executions_project_actor',
  });
  await queryInterface.addIndex('manualExecutions', ['runCaseId', 'status'], {
    name: 'manual_executions_run_case_status',
  });

  await queryInterface.createTable('manualExecutionEvidences', {
    id: { type: Sequelize.INTEGER, primaryKey: true, autoIncrement: true },
    executionId: {
      type: Sequelize.INTEGER,
      allowNull: false,
      references: { model: 'manualExecutions', key: 'id' },
      onUpdate: 'CASCADE',
      onDelete: 'CASCADE',
    },
    uploaderUserId: {
      type: Sequelize.INTEGER,
      allowNull: false,
      references: { model: 'users', key: 'id' },
      onUpdate: 'CASCADE',
      onDelete: 'RESTRICT',
    },
    filename: { type: Sequelize.STRING, allowNull: false },
    storageKey: { type: Sequelize.STRING, allowNull: false, unique: true },
    mimeType: { type: Sequelize.STRING, allowNull: false },
    size: { type: Sequelize.INTEGER, allowNull: false },
    sha256: { type: Sequelize.STRING(64), allowNull: false },
    expiresAt: { type: Sequelize.DATE, allowNull: false },
    createdAt: { type: Sequelize.DATE, allowNull: false },
    updatedAt: { type: Sequelize.DATE, allowNull: false },
  });

  await queryInterface.addIndex('manualExecutionEvidences', ['executionId', 'createdAt'], {
    name: 'manual_execution_evidence_execution_created',
  });
  await queryInterface.addIndex('manualExecutionEvidences', ['expiresAt'], {
    name: 'manual_execution_evidence_expires_at',
  });
}

export async function down(queryInterface) {
  await queryInterface.dropTable('manualExecutionEvidences');
  await queryInterface.dropTable('manualExecutions');
}
