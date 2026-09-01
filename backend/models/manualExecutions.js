function defineManualExecution(sequelize, DataTypes) {
  const ManualExecution = sequelize.define(
    'ManualExecution',
    {
      projectId: { type: DataTypes.INTEGER, allowNull: false },
      runId: { type: DataTypes.INTEGER, allowNull: true },
      runCaseId: { type: DataTypes.INTEGER, allowNull: true },
      caseId: { type: DataTypes.INTEGER, allowNull: true },
      actorUserId: { type: DataTypes.INTEGER, allowNull: false },
      assigneeUserId: { type: DataTypes.INTEGER, allowNull: true },
      status: { type: DataTypes.STRING, allowNull: false, defaultValue: 'running' },
      result: { type: DataTypes.STRING, allowNull: true },
      startedAt: { type: DataTypes.DATE, allowNull: false },
      finishedAt: { type: DataTypes.DATE, allowNull: true },
      caseRevision: { type: DataTypes.INTEGER, allowNull: false },
      caseSnapshot: { type: DataTypes.TEXT, allowNull: false },
      caseSnapshotHash: { type: DataTypes.STRING(64), allowNull: false },
      staleRevision: { type: DataTypes.BOOLEAN, allowNull: false, defaultValue: false },
      activeExecutionKey: { type: DataTypes.STRING, allowNull: true },
      correlationId: { type: DataTypes.STRING, allowNull: false },
      report: { type: DataTypes.TEXT, allowNull: true },
    },
    { tableName: 'manualExecutions' }
  );

  ManualExecution.associate = (models) => {
    ManualExecution.belongsTo(models.Project, { foreignKey: 'projectId', onDelete: 'CASCADE' });
    ManualExecution.belongsTo(models.Run, { foreignKey: 'runId', onDelete: 'SET NULL' });
    ManualExecution.belongsTo(models.RunCase, { foreignKey: 'runCaseId', onDelete: 'SET NULL' });
    ManualExecution.belongsTo(models.Case, { foreignKey: 'caseId', onDelete: 'SET NULL' });
    ManualExecution.belongsTo(models.User, { as: 'actor', foreignKey: 'actorUserId', onDelete: 'RESTRICT' });
    ManualExecution.belongsTo(models.User, { as: 'assignee', foreignKey: 'assigneeUserId', onDelete: 'SET NULL' });
    ManualExecution.hasMany(models.ManualExecutionEvidence, { foreignKey: 'executionId', onDelete: 'CASCADE' });
  };

  return ManualExecution;
}

export default defineManualExecution;
