export async function up(queryInterface, Sequelize) {
  await queryInterface.addColumn('automationExecutions', 'activeExecutionKey', {
    type: Sequelize.STRING,
    allowNull: true,
  });

  const [rows] = await queryInterface.sequelize.query(
    "SELECT id, runCaseId, exampleIndex FROM automationExecutions WHERE runCaseId IS NOT NULL AND status IN ('queued', 'running') ORDER BY id ASC"
  );
  const assignedKeys = new Set();
  const orderedRows = [...rows].sort((left, right) => Number(left.id) - Number(right.id));
  for (const row of orderedRows) {
    const example = row.exampleIndex === null || row.exampleIndex === undefined ? 'scenario' : String(row.exampleIndex);
    const key = `${row.runCaseId}:${example}`;
    const activeExecutionKey = assignedKeys.has(key) ? null : key;
    assignedKeys.add(key);
    await queryInterface.bulkUpdate(
      'automationExecutions',
      { activeExecutionKey },
      { id: row.id }
    );
  }

  await queryInterface.addIndex('automationExecutions', ['activeExecutionKey'], {
    unique: true,
    name: 'automation_executions_active_key_unique',
  });
}

export async function down(queryInterface) {
  await queryInterface.removeIndex('automationExecutions', 'automation_executions_active_key_unique');
  await queryInterface.removeColumn('automationExecutions', 'activeExecutionKey');
}
