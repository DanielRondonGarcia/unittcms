function defineAutomationDefinition(sequelize, DataTypes) {
  const AutomationDefinition = sequelize.define('AutomationDefinition', {
    projectId: { type: DataTypes.INTEGER, allowNull: false },
    caseId: { type: DataTypes.INTEGER, allowNull: false },
    version: { type: DataTypes.INTEGER, allowNull: false },
    snapshot: { type: DataTypes.TEXT, allowNull: false },
    snapshotHash: { type: DataTypes.STRING(64), allowNull: false },
  });
  AutomationDefinition.associate = (models) => {
    AutomationDefinition.belongsTo(models.Project, { foreignKey: 'projectId', onDelete: 'CASCADE' });
    AutomationDefinition.belongsTo(models.Case, { foreignKey: 'caseId', onDelete: 'CASCADE' });
    AutomationDefinition.hasMany(models.AutomationExecution, { foreignKey: 'definitionId', onDelete: 'CASCADE' });
  };
  return AutomationDefinition;
}
export default defineAutomationDefinition;
