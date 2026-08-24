function defineExecutionArtifact(sequelize, DataTypes) {
  const ExecutionArtifact = sequelize.define('ExecutionArtifact', {
    executionId: { type: DataTypes.INTEGER, allowNull: false },
    attempt: { type: DataTypes.INTEGER, allowNull: false },
    kind: { type: DataTypes.STRING, allowNull: false },
    storageKey: { type: DataTypes.STRING, allowNull: false },
    mimeType: { type: DataTypes.STRING, allowNull: false },
    size: { type: DataTypes.INTEGER, allowNull: false },
    sha256: { type: DataTypes.STRING(64), allowNull: false },
    expiresAt: { type: DataTypes.DATE, allowNull: true },
  });
  ExecutionArtifact.associate = (models) =>
    ExecutionArtifact.belongsTo(models.AutomationExecution, { foreignKey: 'executionId', onDelete: 'CASCADE' });
  return ExecutionArtifact;
}
export default defineExecutionArtifact;
