export async function up(queryInterface, Sequelize) {
  await queryInterface.addColumn('automationExecutions', 'exampleIndex', {
    type: Sequelize.INTEGER,
    allowNull: true,
  });
}

export async function down(queryInterface) {
  await queryInterface.removeColumn('automationExecutions', 'exampleIndex');
}
