export async function up(queryInterface, Sequelize) {
  await queryInterface.addColumn('caseSteps', 'keyword', {
    type: Sequelize.STRING,
    allowNull: true,
  });
}

export async function down(queryInterface) {
  await queryInterface.removeColumn('caseSteps', 'keyword');
}
