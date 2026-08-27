export async function up(queryInterface, Sequelize) {
  await queryInterface.addColumn('cases', 'gherkinExamples', {
    type: Sequelize.TEXT,
    allowNull: true,
    defaultValue: null,
  });
}

export async function down(queryInterface) {
  await queryInterface.removeColumn('cases', 'gherkinExamples');
}
