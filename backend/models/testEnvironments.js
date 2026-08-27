function defineTestEnvironment(sequelize, DataTypes) {
  const parseArray = (value) => {
    if (Array.isArray(value)) return value;
    if (typeof value !== 'string' || !value.trim()) return [];
    try {
      const parsed = JSON.parse(value);
      return Array.isArray(parsed) ? parsed : [];
    } catch {
      return [];
    }
  };

  const serializeArray = (value) => JSON.stringify(parseArray(value));

  const TestEnvironment = sequelize.define('TestEnvironment', {
    projectId: { type: DataTypes.INTEGER, allowNull: false },
    name: { type: DataTypes.STRING, allowNull: false },
    baseUrl: { type: DataTypes.STRING, allowNull: false },
    allowedHosts: {
      type: DataTypes.TEXT,
      allowNull: false,
      defaultValue: '[]',
      get() {
        return parseArray(this.getDataValue('allowedHosts'));
      },
      set(value) {
        this.setDataValue('allowedHosts', serializeArray(value));
      },
    },
    secretRefs: {
      type: DataTypes.TEXT,
      allowNull: false,
      defaultValue: '[]',
      get() {
        return parseArray(this.getDataValue('secretRefs'));
      },
      set(value) {
        this.setDataValue('secretRefs', serializeArray(value));
      },
    },
    enabled: { type: DataTypes.BOOLEAN, allowNull: false, defaultValue: true },
    isDefault: { type: DataTypes.BOOLEAN, allowNull: false, defaultValue: false },
    captureVideo: { type: DataTypes.BOOLEAN, allowNull: false, defaultValue: false },
  });
  TestEnvironment.associate = (models) => {
    TestEnvironment.belongsTo(models.Project, { foreignKey: 'projectId', onDelete: 'CASCADE' });
    TestEnvironment.hasMany(models.AutomationExecution, { foreignKey: 'environmentId', onDelete: 'SET NULL' });
  };
  return TestEnvironment;
}
export default defineTestEnvironment;
