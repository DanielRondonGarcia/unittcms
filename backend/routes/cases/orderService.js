import { DataTypes } from 'sequelize';
import defineCase from '../../models/cases.js';
import defineFolder from '../../models/folders.js';

export class CaseOrderError extends Error {
  constructor(code, message, status = 400, details = {}) {
    super(message);
    this.name = 'CaseOrderError';
    this.code = code;
    this.status = status;
    Object.assign(this, details);
  }
}

export class CaseOrderValidationError extends CaseOrderError {}

function positiveInteger(value, field) {
  const number =
    typeof value === 'number' ? value : typeof value === 'string' && /^\d+$/.test(value.trim()) ? Number(value) : NaN;

  if (!Number.isSafeInteger(number) || number <= 0) {
    throw new CaseOrderValidationError(`${field}_invalid`, `${field} must be a positive integer`);
  }

  return number;
}

function optionalPosition(value) {
  if (value === undefined || value === null) return null;
  return positiveInteger(value, 'position');
}

function transactionOptions(transaction, options = {}) {
  return transaction === undefined || transaction === null ? options : { ...options, transaction };
}

function rowId(row) {
  return positiveInteger(row.id, 'caseId');
}

function rowFolderId(row) {
  return positiveInteger(row.folderId, 'folderId');
}

function sameId(left, right) {
  return Number(left) === Number(right);
}

function uniqueIds(ids) {
  return new Set(ids).size === ids.length;
}

function temporaryPositions(existingPositions, count) {
  const used = new Set(
    existingPositions.filter((position) => Number.isSafeInteger(Number(position))).map((position) => Number(position))
  );
  const result = [];
  let candidate = -1;

  while (result.length < count) {
    while (used.has(candidate)) candidate -= 1;
    result.push(candidate);
    used.add(candidate);
    candidate -= 1;
  }

  return result;
}

function isUpdateEmpty(result) {
  return (Array.isArray(result) && result[0] === 0) || result === 0;
}

export function createCaseOrderService(options = {}) {
  const suppliedModels = options.models ?? {};
  const sequelize = options.sequelize ?? (typeof options.transaction === 'function' ? options : null);
  const Case = options.Case ?? suppliedModels.Case ?? (sequelize ? defineCase(sequelize, DataTypes) : null);
  const Folder = options.Folder ?? suppliedModels.Folder ?? (sequelize ? defineFolder(sequelize, DataTypes) : null);

  if (!Case || typeof Case.findAll !== 'function') {
    throw new TypeError('Case model is required');
  }

  const runInTransaction = (transaction, work) => {
    if (transaction !== undefined && transaction !== null) return work(transaction);
    if (!sequelize || typeof sequelize.transaction !== 'function') {
      throw new CaseOrderError('transaction_required', 'A Sequelize transaction is required', 500);
    }
    return sequelize.transaction(work);
  };

  const loadFolder = async (folderId, transaction) => {
    if (!Folder || typeof Folder.findByPk !== 'function') return null;

    const folder = await Folder.findByPk(folderId, transactionOptions(transaction));
    if (!folder) {
      throw new CaseOrderError('folder_not_found', 'Folder not found', 404, { folderId });
    }
    return folder;
  };

  const listFolderCases = async (folderId, { transaction } = {}) => {
    const normalizedFolderId = positiveInteger(folderId, 'folderId');
    return Case.findAll(
      transactionOptions(transaction, {
        where: { folderId: normalizedFolderId },
        order: [
          ['position', 'ASC'],
          ['id', 'ASC'],
        ],
      })
    );
  };

  const loadCase = async (caseId, transaction) => {
    const normalizedCaseId = positiveInteger(caseId, 'caseId');
    const testcase = await Case.findByPk(normalizedCaseId, transactionOptions(transaction));
    if (!testcase) {
      throw new CaseOrderError('case_not_found', 'Case not found', 404, { caseId: normalizedCaseId });
    }
    return testcase;
  };

  const updatePosition = async (folderId, testcase, position, transaction) => {
    const result = await Case.update(
      { position },
      transactionOptions(transaction, {
        where: { id: rowId(testcase), folderId },
      })
    );

    if (isUpdateEmpty(result)) {
      throw new CaseOrderError('case_not_found', 'Case not found in folder', 404, {
        caseId: rowId(testcase),
        folderId,
      });
    }

    testcase.position = position;
  };

  const writeOrderedCases = async (folderId, cases, transaction) => {
    const rows = [...cases];
    const temporary = temporaryPositions(
      rows.map((testcase) => testcase.position),
      rows.length
    );

    for (let index = 0; index < rows.length; index += 1) {
      await updatePosition(folderId, rows[index], temporary[index], transaction);
    }

    for (let index = 0; index < rows.length; index += 1) {
      await updatePosition(folderId, rows[index], index + 1, transaction);
    }

    return rows;
  };

  const readAfterWrite = (folderId, transaction) => listFolderCases(folderId, { transaction });

  const normalizeFolder = async (folderId, { transaction } = {}) => {
    const normalizedFolderId = positiveInteger(folderId, 'folderId');

    return runInTransaction(transaction, async (activeTransaction) => {
      await loadFolder(normalizedFolderId, activeTransaction);
      const cases = await listFolderCases(normalizedFolderId, { transaction: activeTransaction });
      await writeOrderedCases(normalizedFolderId, cases, activeTransaction);
      return readAfterWrite(normalizedFolderId, activeTransaction);
    });
  };

  const placeCase = async ({ caseId, folderId, position, transaction } = {}) => {
    const normalizedCaseId = positiveInteger(caseId, 'caseId');
    const requestedPosition = optionalPosition(position);

    return runInTransaction(transaction, async (activeTransaction) => {
      const testcase = await loadCase(normalizedCaseId, activeTransaction);
      const currentFolderId = rowFolderId(testcase);
      const targetFolderId =
        folderId === undefined || folderId === null ? currentFolderId : positiveInteger(folderId, 'folderId');

      if (currentFolderId !== targetFolderId) {
        throw new CaseOrderValidationError(
          'case_folder_mismatch',
          'Case does not belong to the requested folder',
          400,
          { caseId: normalizedCaseId, folderId: targetFolderId }
        );
      }

      await loadFolder(targetFolderId, activeTransaction);
      const cases = await listFolderCases(targetFolderId, { transaction: activeTransaction });
      const withoutCase = cases.filter((row) => !sameId(row.id, normalizedCaseId));
      const maxPosition = withoutCase.length + 1;

      if (requestedPosition !== null && requestedPosition > maxPosition) {
        throw new CaseOrderValidationError(
          'position_out_of_range',
          `position must be between 1 and ${maxPosition}`,
          400,
          { folderId: targetFolderId, position: requestedPosition, maxPosition }
        );
      }

      const targetPosition = requestedPosition ?? maxPosition;
      const orderedCases = [...withoutCase];
      orderedCases.splice(targetPosition - 1, 0, testcase);
      await writeOrderedCases(targetFolderId, orderedCases, activeTransaction);
      return readAfterWrite(targetFolderId, activeTransaction);
    });
  };

  const appendCase = ({ caseId, folderId, transaction } = {}) =>
    placeCase({ caseId, folderId, position: undefined, transaction });

  const insertCase = ({ caseId, folderId, position, transaction } = {}) => {
    if (position === undefined || position === null) {
      throw new CaseOrderValidationError('position_required', 'position is required for an explicit insert');
    }
    return placeCase({ caseId, folderId, position, transaction });
  };

  const moveCase = ({ caseId, position, transaction } = {}) => {
    if (position === undefined || position === null) {
      throw new CaseOrderValidationError('position_required', 'position is required for a position update');
    }
    return placeCase({ caseId, position, transaction });
  };

  const createCase = async ({ attributes, folderId, position, transaction } = {}) => {
    if (attributes === null || typeof attributes !== 'object' || Array.isArray(attributes)) {
      throw new CaseOrderValidationError('case_attributes_invalid', 'Case attributes must be an object');
    }

    const requestedFolderId = folderId ?? attributes.folderId;
    const normalizedFolderId = positiveInteger(requestedFolderId, 'folderId');
    const requestedPosition = position === undefined ? attributes.position : position;
    const normalizedPosition = optionalPosition(requestedPosition);

    return runInTransaction(transaction, async (activeTransaction) => {
      await loadFolder(normalizedFolderId, activeTransaction);
      const existingCases = await listFolderCases(normalizedFolderId, { transaction: activeTransaction });
      const maxPosition = existingCases.length + 1;

      if (normalizedPosition !== null && normalizedPosition > maxPosition) {
        throw new CaseOrderValidationError(
          'position_out_of_range',
          `position must be between 1 and ${maxPosition}`,
          400,
          { folderId: normalizedFolderId, position: normalizedPosition, maxPosition }
        );
      }

      const temporaryPosition = temporaryPositions(
        existingCases.map((testcase) => testcase.position),
        1
      )[0];
      const caseAttributes = { ...attributes };
      delete caseAttributes.position;
      const createdCase = await Case.create(
        {
          ...caseAttributes,
          folderId: normalizedFolderId,
          position: temporaryPosition,
        },
        transactionOptions(activeTransaction)
      );
      createdCase.position = temporaryPosition;
      createdCase.folderId = normalizedFolderId;

      const targetPosition = normalizedPosition ?? maxPosition;
      const orderedCases = [...existingCases];
      orderedCases.splice(targetPosition - 1, 0, createdCase);
      await writeOrderedCases(normalizedFolderId, orderedCases, activeTransaction);

      return (await Case.findByPk(rowId(createdCase), transactionOptions(activeTransaction))) ?? createdCase;
    });
  };

  const validatePermutation = async (folderId, orderedCaseIds, transaction) => {
    if (!Array.isArray(orderedCaseIds)) {
      throw new CaseOrderValidationError('ordered_case_ids_invalid', 'orderedCaseIds must be an array');
    }

    const normalizedIds = orderedCaseIds.map((caseId) => positiveInteger(caseId, 'caseId'));
    if (!uniqueIds(normalizedIds)) {
      throw new CaseOrderValidationError(
        'ordered_case_ids_duplicate',
        'orderedCaseIds must not contain duplicates',
        400,
        {
          orderedCaseIds: normalizedIds,
        }
      );
    }

    const folderCases = await listFolderCases(folderId, { transaction });
    const requestedIds = new Set(normalizedIds);
    const matchingCases =
      normalizedIds.length === 0
        ? []
        : await Case.findAll(
            transactionOptions(transaction, {
              where: { id: normalizedIds },
            })
          );
    const foundIds = new Set(matchingCases.map((testcase) => rowId(testcase)));
    const unknownIds = normalizedIds.filter((caseId) => !foundIds.has(caseId));
    if (unknownIds.length > 0) {
      throw new CaseOrderValidationError('ordered_case_ids_unknown', 'orderedCaseIds contains unknown cases', 404, {
        caseIds: unknownIds,
        folderId,
      });
    }

    const foreignIds = matchingCases
      .filter((testcase) => rowFolderId(testcase) !== folderId)
      .map((testcase) => rowId(testcase));
    if (foreignIds.length > 0) {
      throw new CaseOrderValidationError(
        'ordered_case_ids_foreign',
        'orderedCaseIds contains cases from another folder',
        400,
        {
          caseIds: foreignIds,
          folderId,
        }
      );
    }

    const missingIds = folderCases
      .filter((testcase) => !requestedIds.has(rowId(testcase)))
      .map((testcase) => rowId(testcase));
    if (missingIds.length > 0) {
      throw new CaseOrderValidationError(
        'ordered_case_ids_missing',
        'orderedCaseIds is not a complete folder permutation',
        400,
        {
          caseIds: missingIds,
          folderId,
        }
      );
    }

    return {
      ids: normalizedIds,
      casesById: new Map(folderCases.map((testcase) => [rowId(testcase), testcase])),
    };
  };

  const reorderFolder = async ({ folderId, orderedCaseIds, transaction } = {}) => {
    const normalizedFolderId = positiveInteger(folderId, 'folderId');

    return runInTransaction(transaction, async (activeTransaction) => {
      await loadFolder(normalizedFolderId, activeTransaction);
      const { ids, casesById } = await validatePermutation(normalizedFolderId, orderedCaseIds, activeTransaction);
      const orderedCases = ids.map((caseId) => casesById.get(caseId));
      await writeOrderedCases(normalizedFolderId, orderedCases, activeTransaction);
      return readAfterWrite(normalizedFolderId, activeTransaction);
    });
  };

  const moveCasesToFolder = async ({ caseIds, targetFolderId, transaction } = {}) => {
    if (!Array.isArray(caseIds) || caseIds.length === 0) {
      throw new CaseOrderValidationError('case_ids_invalid', 'caseIds must be a non-empty array');
    }

    const normalizedCaseIds = caseIds.map((caseId) => positiveInteger(caseId, 'caseId'));
    if (!uniqueIds(normalizedCaseIds)) {
      throw new CaseOrderValidationError('case_ids_duplicate', 'caseIds must not contain duplicates');
    }

    const normalizedTargetFolderId = positiveInteger(targetFolderId, 'targetFolderId');

    return runInTransaction(transaction, async (activeTransaction) => {
      await loadFolder(normalizedTargetFolderId, activeTransaction);
      const movingCases = await Case.findAll(
        transactionOptions(activeTransaction, {
          where: { id: normalizedCaseIds },
        })
      );
      const movingById = new Map(movingCases.map((testcase) => [rowId(testcase), testcase]));
      const unknownIds = normalizedCaseIds.filter((caseId) => !movingById.has(caseId));
      if (unknownIds.length > 0) {
        throw new CaseOrderValidationError('case_ids_unknown', 'Some cases were not found', 404, {
          caseIds: unknownIds,
        });
      }

      const sourceFolderIds = [...new Set(movingCases.map((testcase) => rowFolderId(testcase)))];
      const sourceCases = new Map();
      for (const sourceFolderId of sourceFolderIds) {
        await loadFolder(sourceFolderId, activeTransaction);
        sourceCases.set(sourceFolderId, await listFolderCases(sourceFolderId, { transaction: activeTransaction }));
      }

      const targetCases =
        sourceCases.get(normalizedTargetFolderId) ??
        (await listFolderCases(normalizedTargetFolderId, {
          transaction: activeTransaction,
        }));
      const movingIds = new Set(normalizedCaseIds);
      const temporary = temporaryPositions(
        targetCases.map((testcase) => testcase.position),
        normalizedCaseIds.length
      );

      for (let index = 0; index < normalizedCaseIds.length; index += 1) {
        const testcase = movingById.get(normalizedCaseIds[index]);
        const result = await Case.update(
          { folderId: normalizedTargetFolderId, position: temporary[index] },
          transactionOptions(activeTransaction, { where: { id: normalizedCaseIds[index] } })
        );
        if (isUpdateEmpty(result)) {
          throw new CaseOrderError('case_not_found', 'Case not found', 404, { caseId: normalizedCaseIds[index] });
        }
        testcase.folderId = normalizedTargetFolderId;
        testcase.position = temporary[index];
      }

      for (const sourceFolderId of sourceFolderIds) {
        if (sourceFolderId === normalizedTargetFolderId) continue;
        const remainingCases = sourceCases.get(sourceFolderId).filter((testcase) => !movingIds.has(rowId(testcase)));
        await writeOrderedCases(sourceFolderId, remainingCases, activeTransaction);
      }

      const targetOrder = [
        ...targetCases.filter((testcase) => !movingIds.has(rowId(testcase))),
        ...normalizedCaseIds.map((caseId) => movingById.get(caseId)),
      ];
      await writeOrderedCases(normalizedTargetFolderId, targetOrder, activeTransaction);

      return {
        movedCaseIds: normalizedCaseIds,
        targetFolderId: normalizedTargetFolderId,
        targetCases: await readAfterWrite(normalizedTargetFolderId, activeTransaction),
      };
    });
  };

  return {
    listFolderCases,
    normalizeFolder,
    createCase,
    appendCase,
    insertCase,
    moveCase,
    updateCasePosition: moveCase,
    reorderFolder,
    reorderCases: reorderFolder,
    moveCasesToFolder,
  };
}

export default createCaseOrderService;
