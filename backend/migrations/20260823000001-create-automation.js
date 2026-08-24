export async function up(queryInterface, Sequelize) {
  await queryInterface.addColumn('cases', 'automationVersion', {
    type: Sequelize.INTEGER,
    allowNull: false,
    defaultValue: 1,
  });
  await queryInterface.createTable('testEnvironments', {
    id: { type: Sequelize.INTEGER, primaryKey: true, autoIncrement: true },
    projectId: {
      type: Sequelize.INTEGER,
      allowNull: false,
      references: { model: 'projects', key: 'id' },
      onDelete: 'CASCADE',
    },
    name: { type: Sequelize.STRING, allowNull: false },
    baseUrl: { type: Sequelize.STRING, allowNull: false },
    allowedHosts: { type: Sequelize.TEXT, allowNull: false, defaultValue: '[]' },
    secretRefs: { type: Sequelize.TEXT, allowNull: false, defaultValue: '[]' },
    enabled: { type: Sequelize.BOOLEAN, allowNull: false, defaultValue: true },
    createdAt: { type: Sequelize.DATE, allowNull: false },
    updatedAt: { type: Sequelize.DATE, allowNull: false },
  });
  await queryInterface.createTable('automationDefinitions', {
    id: { type: Sequelize.INTEGER, primaryKey: true, autoIncrement: true },
    projectId: {
      type: Sequelize.INTEGER,
      allowNull: false,
      references: { model: 'projects', key: 'id' },
      onDelete: 'CASCADE',
    },
    caseId: {
      type: Sequelize.INTEGER,
      allowNull: false,
      references: { model: 'cases', key: 'id' },
      onDelete: 'CASCADE',
    },
    version: { type: Sequelize.INTEGER, allowNull: false },
    snapshot: { type: Sequelize.TEXT, allowNull: false },
    snapshotHash: { type: Sequelize.STRING(64), allowNull: false },
    createdAt: { type: Sequelize.DATE, allowNull: false },
    updatedAt: { type: Sequelize.DATE, allowNull: false },
  });
  await queryInterface.addIndex('automationDefinitions', ['caseId', 'version'], { unique: true });
  await queryInterface.createTable('automationExecutions', {
    id: { type: Sequelize.INTEGER, primaryKey: true, autoIncrement: true },
    definitionId: {
      type: Sequelize.INTEGER,
      allowNull: false,
      references: { model: 'automationDefinitions', key: 'id' },
      onDelete: 'CASCADE',
    },
    projectId: {
      type: Sequelize.INTEGER,
      allowNull: false,
      references: { model: 'projects', key: 'id' },
      onDelete: 'CASCADE',
    },
    caseId: {
      type: Sequelize.INTEGER,
      allowNull: false,
      references: { model: 'cases', key: 'id' },
      onDelete: 'CASCADE',
    },
    runCaseId: {
      type: Sequelize.INTEGER,
      allowNull: true,
      references: { model: 'runCases', key: 'id' },
      onDelete: 'SET NULL',
    },
    environmentId: {
      type: Sequelize.INTEGER,
      allowNull: true,
      references: { model: 'testEnvironments', key: 'id' },
      onDelete: 'SET NULL',
    },
    status: { type: Sequelize.STRING, allowNull: false, defaultValue: 'queued' },
    attempt: { type: Sequelize.INTEGER, allowNull: false, defaultValue: 1 },
    engine: { type: Sequelize.STRING, allowNull: true },
    model: { type: Sequelize.STRING, allowNull: true },
    queuedAt: { type: Sequelize.DATE, allowNull: false },
    startedAt: { type: Sequelize.DATE, allowNull: true },
    finishedAt: { type: Sequelize.DATE, allowNull: true },
    durationMs: { type: Sequelize.INTEGER, allowNull: true },
    summary: { type: Sequelize.TEXT, allowNull: true },
    error: { type: Sequelize.TEXT, allowNull: true },
    idempotencyKey: { type: Sequelize.STRING, allowNull: false },
    correlationId: { type: Sequelize.STRING, allowNull: false },
    createdAt: { type: Sequelize.DATE, allowNull: false },
    updatedAt: { type: Sequelize.DATE, allowNull: false },
  });
  await queryInterface.addIndex('automationExecutions', ['projectId', 'idempotencyKey'], { unique: true });
  await queryInterface.createTable('executionArtifacts', {
    id: { type: Sequelize.INTEGER, primaryKey: true, autoIncrement: true },
    executionId: {
      type: Sequelize.INTEGER,
      allowNull: false,
      references: { model: 'automationExecutions', key: 'id' },
      onDelete: 'CASCADE',
    },
    attempt: { type: Sequelize.INTEGER, allowNull: false },
    kind: { type: Sequelize.STRING, allowNull: false },
    storageKey: { type: Sequelize.STRING, allowNull: false },
    mimeType: { type: Sequelize.STRING, allowNull: false },
    size: { type: Sequelize.INTEGER, allowNull: false },
    sha256: { type: Sequelize.STRING(64), allowNull: false },
    expiresAt: { type: Sequelize.DATE, allowNull: true },
    createdAt: { type: Sequelize.DATE, allowNull: false },
    updatedAt: { type: Sequelize.DATE, allowNull: false },
  });
}
export async function down(queryInterface) {
  await queryInterface.dropTable('executionArtifacts');
  await queryInterface.dropTable('automationExecutions');
  await queryInterface.dropTable('automationDefinitions');
  await queryInterface.dropTable('testEnvironments');
  await queryInterface.removeColumn('cases', 'automationVersion');
}
