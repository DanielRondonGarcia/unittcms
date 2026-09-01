function defineManualExecutionEvidence(sequelize, DataTypes) {
  const ManualExecutionEvidence = sequelize.define(
    'ManualExecutionEvidence',
    {
      executionId: { type: DataTypes.INTEGER, allowNull: false },
      uploaderUserId: { type: DataTypes.INTEGER, allowNull: false },
      filename: { type: DataTypes.STRING, allowNull: false },
      storageKey: { type: DataTypes.STRING, allowNull: false, unique: true },
      mimeType: { type: DataTypes.STRING, allowNull: false },
      size: { type: DataTypes.INTEGER, allowNull: false },
      sha256: { type: DataTypes.STRING(64), allowNull: false },
      expiresAt: { type: DataTypes.DATE, allowNull: false },
    },
    { tableName: 'manualExecutionEvidences' }
  );

  ManualExecutionEvidence.associate = (models) => {
    ManualExecutionEvidence.belongsTo(models.ManualExecution, { foreignKey: 'executionId', onDelete: 'CASCADE' });
    ManualExecutionEvidence.belongsTo(models.User, {
      as: 'uploader',
      foreignKey: 'uploaderUserId',
      onDelete: 'RESTRICT',
    });
  };

  return ManualExecutionEvidence;
}

export default defineManualExecutionEvidence;
