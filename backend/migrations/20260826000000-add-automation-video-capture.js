export async function up(queryInterface, Sequelize) {
  await queryInterface.addColumn('testEnvironments', 'captureVideo', {
    type: Sequelize.BOOLEAN,
    allowNull: false,
    defaultValue: false,
  });
  await queryInterface.addColumn('automationExecutions', 'captureVideo', {
    type: Sequelize.BOOLEAN,
    allowNull: false,
    defaultValue: false,
  });
}

export async function down(queryInterface) {
  await queryInterface.removeColumn('automationExecutions', 'captureVideo');
  await queryInterface.removeColumn('testEnvironments', 'captureVideo');
}
