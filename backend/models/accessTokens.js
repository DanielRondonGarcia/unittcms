function defineAccessToken(sequelize, DataTypes) {
  const AccessToken = sequelize.define(
    'AccessToken',
    {
      userId: {
        type: DataTypes.INTEGER,
        allowNull: false,
      },
      name: {
        type: DataTypes.STRING(100),
        allowNull: true,
      },
      tokenPrefix: {
        type: DataTypes.STRING(8),
        allowNull: false,
      },
      tokenHash: {
        type: DataTypes.STRING(64),
        allowNull: false,
        unique: true,
      },
      scopes: {
        type: DataTypes.JSON,
        allowNull: false,
      },
      expiresAt: {
        type: DataTypes.DATE,
        allowNull: false,
      },
      revokedAt: {
        type: DataTypes.DATE,
        allowNull: true,
      },
      lastUsedAt: {
        type: DataTypes.DATE,
        allowNull: true,
      },
    },
    {
      tableName: 'access_tokens',
      underscored: true,
    }
  );

  AccessToken.associate = (models) => {
    AccessToken.belongsTo(models.User, { as: 'user', foreignKey: 'userId' });
  };

  return AccessToken;
}

export default defineAccessToken;
