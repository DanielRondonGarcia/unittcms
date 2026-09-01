export async function up(queryInterface, Sequelize) {
  await queryInterface.addColumn('manualExecutions', 'report', {
    type: Sequelize.TEXT,
    allowNull: true,
  });
}

export async function down(queryInterface) {
  await queryInterface.removeColumn('manualExecutions', 'report');
}
