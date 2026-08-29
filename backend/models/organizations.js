function defineOrganization(sequelize, DataTypes) {
  const Organization = sequelize.define('Organization', {
    name: {
      type: DataTypes.STRING,
      allowNull: false,
    },
    ownerUserId: {
      type: DataTypes.INTEGER,
      allowNull: false,
      references: {
        model: 'users',
        key: 'id',
      },
      onDelete: 'CASCADE',
    },
    herculesModel: {
      type: DataTypes.STRING,
      allowNull: true,
    },
  });

  Organization.associate = (models) => {
    Organization.belongsTo(models.User, { foreignKey: 'ownerUserId', onDelete: 'CASCADE' });
    Organization.hasMany(models.Project, { foreignKey: 'organizationId', onDelete: 'SET NULL' });
  };

  return Organization;
}

export default defineOrganization;
