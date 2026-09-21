const TABLE_NAME = 'cases';
const POSITION_COLUMN = 'position';
const POSITION_INDEX_NAME = 'cases_folderId_position_unique';

export async function up(queryInterface, Sequelize) {
  await queryInterface.addColumn(TABLE_NAME, POSITION_COLUMN, {
    type: Sequelize.INTEGER,
    allowNull: true,
    defaultValue: null,
  });

  await queryInterface.sequelize.query('UPDATE "cases" SET "position" = "id" WHERE "position" IS NULL');

  await queryInterface.changeColumn(TABLE_NAME, POSITION_COLUMN, {
    type: Sequelize.INTEGER,
    allowNull: false,
  });

  await queryInterface.addIndex(TABLE_NAME, ['folderId', POSITION_COLUMN], {
    unique: true,
    name: POSITION_INDEX_NAME,
  });
}

export async function down(queryInterface) {
  await queryInterface.removeIndex(TABLE_NAME, POSITION_INDEX_NAME);
  await queryInterface.removeColumn(TABLE_NAME, POSITION_COLUMN);
}
