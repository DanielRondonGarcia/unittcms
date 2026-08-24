function defineTestEnvironment(sequelize, DataTypes) {
  const TestEnvironment = sequelize.define('TestEnvironment', {
    projectId: { type: DataTypes.INTEGER, allowNull: false },
    name: { type: DataTypes.STRING, allowNull: false },
    baseUrl: { type: DataTypes.STRING, allowNull: false },
    allowedHosts: { type: DataTypes.TEXT, allowNull: false, defaultValue: '[]' },
    secretRefs: { type: DataTypes.TEXT, allowNull: false, defaultValue: '[]' },
    enabled: { type: DataTypes.BOOLEAN, allowNull: false, defaultValue: true },
  });
  TestEnvironment.associate = (models) => {
    TestEnvironment.belongsTo(models.Project, { foreignKey: 'projectId', onDelete: 'CASCADE' });
    TestEnvironment.hasMany(models.AutomationExecution, { foreignKey: 'environmentId', onDelete: 'SET NULL' });
  };
  return TestEnvironment;
}
export default defineTestEnvironment;
