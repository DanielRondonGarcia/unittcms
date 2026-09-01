function defineProject(sequelize, DataTypes) {
  const Project = sequelize.define('Project', {
    name: {
      type: DataTypes.STRING,
      allowNull: false,
    },
    detail: {
      type: DataTypes.STRING,
      allowNull: true,
    },
    isPublic: {
      type: DataTypes.BOOLEAN,
      allowNull: false,
    },
    userId: {
      type: DataTypes.INTEGER,
      allowNull: false,
      references: {
        model: 'user',
        key: 'id',
      },
      onDelete: 'CASCADE',
    },
    organizationId: {
      type: DataTypes.INTEGER,
      allowNull: true,
      references: {
        model: 'organizations',
        key: 'id',
      },
      onDelete: 'SET NULL',
    },
  });

  Project.associate = (models) => {
    Project.belongsTo(models.User, { foreignKey: 'userId', onDelete: 'CASCADE' });
    Project.belongsTo(models.Organization, { foreignKey: 'organizationId', onDelete: 'SET NULL' });
    Project.hasMany(models.Folder, { foreignKey: 'projectId', onDelete: 'CASCADE' });
    Project.hasMany(models.Run, { foreignKey: 'projectId', onDelete: 'CASCADE' });
    Project.hasMany(models.AutomationDefinition, { foreignKey: 'projectId', onDelete: 'CASCADE' });
    Project.hasMany(models.AutomationExecution, { foreignKey: 'projectId', onDelete: 'CASCADE' });
    Project.hasMany(models.TestEnvironment, { foreignKey: 'projectId', onDelete: 'CASCADE' });
    Project.hasMany(models.ManualExecution, { foreignKey: 'projectId', onDelete: 'CASCADE' });
  };

  return Project;
}

export default defineProject;
