function defineAutomationExecution(sequelize, DataTypes) {
  const AutomationExecution = sequelize.define('AutomationExecution', {
    definitionId: { type: DataTypes.INTEGER, allowNull: false },
    projectId: { type: DataTypes.INTEGER, allowNull: false },
    caseId: { type: DataTypes.INTEGER, allowNull: false },
    exampleIndex: { type: DataTypes.INTEGER, allowNull: true },
    runCaseId: { type: DataTypes.INTEGER, allowNull: true },
    environmentId: { type: DataTypes.INTEGER, allowNull: true },
    captureVideo: { type: DataTypes.BOOLEAN, allowNull: false, defaultValue: false },
    status: { type: DataTypes.STRING, allowNull: false, defaultValue: 'queued' },
    attempt: { type: DataTypes.INTEGER, allowNull: false, defaultValue: 1 },
    engine: { type: DataTypes.STRING, allowNull: true },
    model: { type: DataTypes.STRING, allowNull: true },
    queuedAt: { type: DataTypes.DATE, allowNull: false, defaultValue: DataTypes.NOW },
    startedAt: { type: DataTypes.DATE, allowNull: true },
    finishedAt: { type: DataTypes.DATE, allowNull: true },
    durationMs: { type: DataTypes.INTEGER, allowNull: true },
    summary: { type: DataTypes.TEXT, allowNull: true },
    error: { type: DataTypes.TEXT, allowNull: true },
    errorKind: { type: DataTypes.STRING, allowNull: true },
    diagnostics: { type: DataTypes.TEXT, allowNull: true },
    activeExecutionKey: { type: DataTypes.STRING, allowNull: true },
    attemptHistory: { type: DataTypes.TEXT, allowNull: false, defaultValue: '[]' },
    lastWorkerEvent: { type: DataTypes.STRING, allowNull: true },
    lastAttemptStatus: { type: DataTypes.STRING, allowNull: true },
    idempotencyKey: { type: DataTypes.STRING, allowNull: false },
    correlationId: { type: DataTypes.STRING, allowNull: false },
  });
  AutomationExecution.associate = (models) => {
    AutomationExecution.belongsTo(models.AutomationDefinition, { foreignKey: 'definitionId', onDelete: 'CASCADE' });
    AutomationExecution.belongsTo(models.Project, { foreignKey: 'projectId', onDelete: 'CASCADE' });
    AutomationExecution.belongsTo(models.Case, { foreignKey: 'caseId', onDelete: 'CASCADE' });
    AutomationExecution.belongsTo(models.RunCase, { foreignKey: 'runCaseId', onDelete: 'SET NULL' });
    AutomationExecution.belongsTo(models.TestEnvironment, { foreignKey: 'environmentId', onDelete: 'SET NULL' });
    AutomationExecution.hasMany(models.ExecutionArtifact, { foreignKey: 'executionId', onDelete: 'CASCADE' });
    AutomationExecution.hasMany(models.ExecutionEvent, { foreignKey: 'executionId', onDelete: 'CASCADE' });
  };
  return AutomationExecution;
}
export default defineAutomationExecution;
