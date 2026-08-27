export async function up(queryInterface, Sequelize) {
  await queryInterface.addColumn('caseSteps', 'section', {
    type: Sequelize.STRING,
    allowNull: false,
    defaultValue: 'scenario',
  });
}

export async function down(queryInterface) {
  await queryInterface.removeColumn('caseSteps', 'section');
}
