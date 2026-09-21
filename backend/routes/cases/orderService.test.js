import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { DataTypes, Sequelize } from 'sequelize';
import defineCase from '../../models/cases.js';
import defineFolder from '../../models/folders.js';
import createCaseOrderService from './orderService.js';

describe('case order service', () => {
  let sequelize;
  let Case;
  let Folder;
  let service;
  let folderSequence;

  beforeEach(async () => {
    sequelize = new Sequelize({
      dialect: 'sqlite',
      storage: ':memory:',
      logging: false,
    });
    Folder = defineFolder(sequelize, DataTypes);
    Case = defineCase(sequelize, DataTypes);
    await sequelize.sync({ force: true });
    await sequelize.query('PRAGMA foreign_keys = OFF');
    await sequelize.getQueryInterface().addIndex(Case.getTableName(), ['folderId', 'position'], {
      unique: true,
      name: 'cases_folderId_position_unique',
    });
    service = createCaseOrderService({ sequelize, Case, Folder });
    folderSequence = 0;
  });

  afterEach(async () => {
    await sequelize.close();
  });

  async function createFolder() {
    folderSequence += 1;
    return Folder.create({ name: `Folder ${folderSequence}`, projectId: 1 });
  }

  function caseAttributes(folderId, title = 'Case') {
    return {
      title,
      state: 1,
      priority: 1,
      type: 1,
      automationStatus: 0,
      template: 0,
      folderId,
    };
  }

  async function createCase(folderId, position, title = 'Case') {
    return Case.create({ ...caseAttributes(folderId, title), position });
  }

  async function ordered(folderId) {
    return service.listFolderCases(folderId);
  }

  it('normalizes a folder to contiguous one-based positions', async () => {
    const folder = await createFolder();
    await createCase(folder.id, 4, 'first');
    await createCase(folder.id, 9, 'second');
    await createCase(folder.id, 21, 'third');

    await service.normalizeFolder(folder.id);

    expect((await ordered(folder.id)).map((testcase) => testcase.position)).toEqual([1, 2, 3]);
  });

  it('creates without a requested position by appending and can append an existing new case', async () => {
    const folder = await createFolder();
    await createCase(folder.id, 1, 'first');
    await createCase(folder.id, 2, 'second');

    const created = await service.createCase({ attributes: caseAttributes(folder.id, 'created') });
    expect((await ordered(folder.id)).map((testcase) => testcase.id)).toEqual([1, 2, created.id]);
    expect(created.position).toBe(3);

    const another = await createCase(folder.id, 99, 'another');
    await service.appendCase({ caseId: another.id, folderId: folder.id });
    expect((await ordered(folder.id)).map((testcase) => testcase.id)).toEqual([1, 2, created.id, another.id]);
    expect((await ordered(folder.id)).map((testcase) => testcase.position)).toEqual([1, 2, 3, 4]);
  });

  it('inserts a case at an explicit position and shifts its neighbors', async () => {
    const folder = await createFolder();
    const first = await createCase(folder.id, 1, 'first');
    const second = await createCase(folder.id, 2, 'second');
    const third = await createCase(folder.id, 3, 'third');
    const inserted = await createCase(folder.id, 99, 'inserted');

    await service.insertCase({ caseId: inserted.id, folderId: folder.id, position: 2 });

    expect((await ordered(folder.id)).map((testcase) => testcase.id)).toEqual([
      first.id,
      inserted.id,
      second.id,
      third.id,
    ]);
    expect((await ordered(folder.id)).map((testcase) => testcase.position)).toEqual([1, 2, 3, 4]);
  });

  it('moves an existing case within its folder to an explicit position', async () => {
    const folder = await createFolder();
    const first = await createCase(folder.id, 1, 'first');
    const second = await createCase(folder.id, 2, 'second');
    const third = await createCase(folder.id, 3, 'third');

    await service.moveCase({ caseId: third.id, position: 1 });

    expect((await ordered(folder.id)).map((testcase) => testcase.id)).toEqual([third.id, first.id, second.id]);
    expect((await ordered(folder.id)).map((testcase) => testcase.position)).toEqual([1, 2, 3]);
  });

  it('applies a valid complete permutation and preserves immutable ids', async () => {
    const folder = await createFolder();
    for (let position = 1; position <= 10; position += 1) {
      await createCase(folder.id, position, `case ${position}`);
    }

    await sequelize.transaction(async (transaction) => {
      await service.reorderFolder({
        folderId: folder.id,
        orderedCaseIds: [1, 2, 10, 3, 4, 5, 6, 7, 8, 9],
        transaction,
      });
    });

    const cases = await ordered(folder.id);
    expect(cases.map((testcase) => testcase.id)).toEqual([1, 2, 10, 3, 4, 5, 6, 7, 8, 9]);
    expect(cases.map((testcase) => testcase.position)).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10]);
    expect(new Set(cases.map((testcase) => testcase.id))).toEqual(new Set([1, 2, 3, 4, 5, 6, 7, 8, 9, 10]));
  });

  it('rejects duplicate, missing, unknown, and foreign ids before any write', async () => {
    const folder = await createFolder();
    const otherFolder = await createFolder();
    const first = await createCase(folder.id, 1, 'first');
    const second = await createCase(folder.id, 2, 'second');
    const third = await createCase(folder.id, 3, 'third');
    const foreign = await createCase(otherFolder.id, 1, 'foreign');
    const updateSpy = vi.spyOn(Case, 'update');

    await expect(
      service.reorderFolder({ folderId: folder.id, orderedCaseIds: [first.id, first.id, second.id] })
    ).rejects.toMatchObject({ code: 'ordered_case_ids_duplicate' });
    await expect(
      service.reorderFolder({ folderId: folder.id, orderedCaseIds: [first.id, second.id] })
    ).rejects.toMatchObject({ code: 'ordered_case_ids_missing' });
    await expect(
      service.reorderFolder({ folderId: folder.id, orderedCaseIds: [first.id, second.id, 999999] })
    ).rejects.toMatchObject({ code: 'ordered_case_ids_unknown' });
    await expect(
      service.reorderFolder({ folderId: folder.id, orderedCaseIds: [first.id, second.id, foreign.id] })
    ).rejects.toMatchObject({ code: 'ordered_case_ids_foreign' });

    expect(updateSpy).not.toHaveBeenCalled();
    expect(third.position).toBe(3);
    updateSpy.mockRestore();
  });

  it('moves multiple cases to another folder in request order and resequences the source', async () => {
    const source = await createFolder();
    const target = await createFolder();
    const sourceCases = [];
    for (let position = 1; position <= 4; position += 1) {
      sourceCases.push(await createCase(source.id, position, `source ${position}`));
    }
    const targetFirst = await createCase(target.id, 1, 'target first');
    const targetSecond = await createCase(target.id, 2, 'target second');

    await service.moveCasesToFolder({
      caseIds: [sourceCases[1].id, sourceCases[3].id],
      targetFolderId: target.id,
    });

    expect((await ordered(source.id)).map((testcase) => testcase.id)).toEqual([sourceCases[0].id, sourceCases[2].id]);
    expect((await ordered(source.id)).map((testcase) => testcase.position)).toEqual([1, 2]);
    expect((await ordered(target.id)).map((testcase) => testcase.id)).toEqual([
      targetFirst.id,
      targetSecond.id,
      sourceCases[1].id,
      sourceCases[3].id,
    ]);
    expect((await ordered(target.id)).map((testcase) => testcase.position)).toEqual([1, 2, 3, 4]);
  });

  it('rolls back temporary and final writes when persistence fails', async () => {
    const folder = await createFolder();
    const first = await createCase(folder.id, 1, 'first');
    const second = await createCase(folder.id, 2, 'second');
    const third = await createCase(folder.id, 3, 'third');
    const before = (await ordered(folder.id)).map((testcase) => ({ id: testcase.id, position: testcase.position }));
    const originalUpdate = Case.update.bind(Case);
    const failure = new Error('simulated persistence failure');
    let updateCount = 0;
    const updateSpy = vi.spyOn(Case, 'update').mockImplementation((...args) => {
      updateCount += 1;
      if (updateCount === 2) return Promise.reject(failure);
      return originalUpdate(...args);
    });

    await expect(
      service.reorderFolder({ folderId: folder.id, orderedCaseIds: [third.id, first.id, second.id] })
    ).rejects.toBe(failure);
    updateSpy.mockRestore();

    expect((await ordered(folder.id)).map((testcase) => ({ id: testcase.id, position: testcase.position }))).toEqual(
      before
    );
  });
});
