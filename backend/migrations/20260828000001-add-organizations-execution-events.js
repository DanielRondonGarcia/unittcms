export async function up(queryInterface, Sequelize) {
  await queryInterface.createTable('organizations', {
    id: { type: Sequelize.INTEGER, primaryKey: true, autoIncrement: true },
    name: { type: Sequelize.STRING, allowNull: false },
    ownerUserId: {
      type: Sequelize.INTEGER,
      allowNull: false,
      references: { model: 'users', key: 'id' },
      onDelete: 'CASCADE',
    },
    herculesModel: { type: Sequelize.STRING, allowNull: true },
    createdAt: { type: Sequelize.DATE, allowNull: false },
    updatedAt: { type: Sequelize.DATE, allowNull: false },
  });
  await queryInterface.addIndex('organizations', ['ownerUserId'], { unique: true });

  await queryInterface.addColumn('projects', 'organizationId', {
    type: Sequelize.INTEGER,
    allowNull: true,
    references: { model: 'organizations', key: 'id' },
    onDelete: 'SET NULL',
  });

  const [projects] = await queryInterface.sequelize.query(
    'SELECT "userId" FROM "projects" WHERE "organizationId" IS NULL'
  );
  const ownerIds = [
    ...new Set(projects.map((project) => Number(project.userId)).filter((id) => Number.isInteger(id) && id > 0)),
  ];
  for (const ownerUserId of ownerIds) {
    const now = new Date();
    await queryInterface.bulkInsert('organizations', [
      {
        name: `Organization ${ownerUserId}`,
        ownerUserId,
        herculesModel: null,
        createdAt: now,
        updatedAt: now,
      },
    ]);
    const [organizations] = await queryInterface.sequelize.query(
      'SELECT "id" FROM "organizations" WHERE "ownerUserId" = :ownerUserId ORDER BY "id" DESC LIMIT 1',
      { replacements: { ownerUserId } }
    );
    const organizationId = Number(organizations[0]?.id);
    if (Number.isInteger(organizationId) && organizationId > 0) {
      await queryInterface.bulkUpdate('projects', { organizationId }, { userId: ownerUserId, organizationId: null });
    }
  }

  await queryInterface.addColumn('automationExecutions', 'diagnostics', {
    type: Sequelize.TEXT,
    allowNull: true,
  });

  await queryInterface.createTable('executionEvents', {
    id: { type: Sequelize.INTEGER, primaryKey: true, autoIncrement: true },
    executionId: {
      type: Sequelize.INTEGER,
      allowNull: false,
      references: { model: 'automationExecutions', key: 'id' },
      onDelete: 'CASCADE',
    },
    attempt: { type: Sequelize.INTEGER, allowNull: false },
    sequence: { type: Sequelize.INTEGER, allowNull: false },
    eventType: { type: Sequelize.STRING, allowNull: false },
    message: { type: Sequelize.STRING, allowNull: true },
    details: { type: Sequelize.TEXT, allowNull: true },
    createdAt: { type: Sequelize.DATE, allowNull: false },
    updatedAt: { type: Sequelize.DATE, allowNull: false },
  });
  await queryInterface.addIndex('executionEvents', ['executionId', 'sequence'], { unique: true });
}

export async function down(queryInterface) {
  await queryInterface.removeIndex('executionEvents', 'executionEvents_executionId_sequence');
  await queryInterface.dropTable('executionEvents');
  await queryInterface.removeColumn('automationExecutions', 'diagnostics');
  await queryInterface.removeColumn('projects', 'organizationId');
  await queryInterface.removeIndex('organizations', 'organizations_ownerUserId');
  await queryInterface.dropTable('organizations');
}
