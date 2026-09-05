export async function up(queryInterface, Sequelize) {
  await queryInterface.createTable('access_tokens', {
    id: { type: Sequelize.INTEGER, primaryKey: true, autoIncrement: true },
    userId: {
      type: Sequelize.INTEGER,
      allowNull: false,
      references: { model: 'users', key: 'id' },
      onUpdate: 'CASCADE',
      onDelete: 'CASCADE',
    },
    name: { type: Sequelize.STRING(100), allowNull: true },
    tokenPrefix: { type: Sequelize.STRING(8), allowNull: false },
    tokenHash: { type: Sequelize.STRING(64), allowNull: false, unique: true },
    scopes: { type: Sequelize.JSON, allowNull: false },
    expiresAt: { type: Sequelize.DATE, allowNull: false },
    revokedAt: { type: Sequelize.DATE, allowNull: true },
    lastUsedAt: { type: Sequelize.DATE, allowNull: true },
    createdAt: { type: Sequelize.DATE, allowNull: false },
    updatedAt: { type: Sequelize.DATE, allowNull: false },
  });

  await queryInterface.addIndex('access_tokens', ['userId', 'createdAt'], {
    name: 'access_tokens_user_created_at',
  });
}

export async function down(queryInterface) {
  await queryInterface.dropTable('access_tokens');
}
