export async function up(queryInterface, Sequelize) {
  await queryInterface.addColumn('testEnvironments', 'isDefault', {
    type: Sequelize.BOOLEAN,
    allowNull: false,
    defaultValue: false,
  });
  await queryInterface.addIndex('testEnvironments', ['projectId'], {
    name: 'test_environments_one_default_per_project',
    unique: true,
    where: { isDefault: true },
  });
}

export async function down(queryInterface) {
  await queryInterface.removeIndex('testEnvironments', 'test_environments_one_default_per_project');
  await queryInterface.removeColumn('testEnvironments', 'isDefault');
}
