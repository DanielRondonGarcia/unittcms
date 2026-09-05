const TABLE_NAME = 'access_tokens';
const INDEX_NAME = 'access_tokens_user_created_at';
const COLUMN_RENAMES = [
  ['userId', 'user_id'],
  ['tokenPrefix', 'token_prefix'],
  ['tokenHash', 'token_hash'],
  ['expiresAt', 'expires_at'],
  ['revokedAt', 'revoked_at'],
  ['lastUsedAt', 'last_used_at'],
  ['createdAt', 'created_at'],
  ['updatedAt', 'updated_at'],
];

async function renameColumns(queryInterface, fromSuffix, toSuffix) {
  const columns = await queryInterface.describeTable(TABLE_NAME);
  for (const [from, to] of COLUMN_RENAMES) {
    const source = fromSuffix ? to : from;
    const target = fromSuffix ? from : to;
    if (columns[source] && !columns[target]) {
      await queryInterface.renameColumn(TABLE_NAME, source, target);
    }
  }
}

export async function up(queryInterface) {
  const indexes = await queryInterface.showIndex(TABLE_NAME);
  if (indexes.some((index) => index.name === INDEX_NAME)) {
    await queryInterface.removeIndex(TABLE_NAME, INDEX_NAME);
  }

  await renameColumns(queryInterface, false, true);
  await queryInterface.addIndex(TABLE_NAME, ['user_id', 'created_at'], { name: INDEX_NAME });
}

export async function down(queryInterface) {
  const indexes = await queryInterface.showIndex(TABLE_NAME);
  if (indexes.some((index) => index.name === INDEX_NAME)) {
    await queryInterface.removeIndex(TABLE_NAME, INDEX_NAME);
  }

  await renameColumns(queryInterface, true, false);
  await queryInterface.addIndex(TABLE_NAME, ['userId', 'createdAt'], { name: INDEX_NAME });
}
