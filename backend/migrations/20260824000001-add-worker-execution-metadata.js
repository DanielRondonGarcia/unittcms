export async function up(queryInterface, Sequelize) {
  await queryInterface.addColumn('automationExecutions', 'errorKind', {
    type: Sequelize.STRING,
    allowNull: true,
  });
  await queryInterface.addColumn('automationExecutions', 'attemptHistory', {
    type: Sequelize.TEXT,
    allowNull: false,
    defaultValue: '[]',
  });
  await queryInterface.addColumn('automationExecutions', 'lastWorkerEvent', {
    type: Sequelize.STRING,
    allowNull: true,
  });
  await queryInterface.addColumn('automationExecutions', 'lastAttemptStatus', {
    type: Sequelize.STRING,
    allowNull: true,
  });
}

export async function down(queryInterface) {
  await queryInterface.removeColumn('automationExecutions', 'lastAttemptStatus');
  await queryInterface.removeColumn('automationExecutions', 'lastWorkerEvent');
  await queryInterface.removeColumn('automationExecutions', 'attemptHistory');
  await queryInterface.removeColumn('automationExecutions', 'errorKind');
}
