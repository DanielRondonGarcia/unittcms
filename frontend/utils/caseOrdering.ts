export type CaseOrderRow = {
  id: number;
  position?: number | null;
};

export type CaseFolderOrderRow = CaseOrderRow & {
  folderId: number;
};

export type CaseSortDescriptor = {
  column?: string;
  direction?: string;
};

export type CaseOrderingView = {
  isFiltered?: boolean;
  sortDescriptor?: CaseSortDescriptor | null;
};

export type CaseDragOptions = CaseOrderingView & {
  selectedCaseIds?: readonly number[];
};

export const CANONICAL_CASE_SORT = {
  column: 'position',
  direction: 'ascending',
} as const;

export function normalizeCasePosition(value: unknown): number | undefined {
  if (typeof value === 'number') {
    return Number.isSafeInteger(value) && value > 0 ? value : undefined;
  }

  if (typeof value === 'string' && value.trim() !== '') {
    const normalized = Number(value);
    return Number.isSafeInteger(normalized) && normalized > 0 ? normalized : undefined;
  }

  return undefined;
}

function normalizeCaseId(value: unknown): number | undefined {
  if (typeof value === 'number') {
    return Number.isSafeInteger(value) && value > 0 ? value : undefined;
  }

  if (typeof value === 'string' && value.trim() !== '') {
    const normalized = Number(value);
    return Number.isSafeInteger(normalized) && normalized > 0 ? normalized : undefined;
  }

  return undefined;
}

function compareNumbers(left: number, right: number): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

export function sortCasesByPosition<T extends CaseOrderRow>(rows: readonly T[]): T[] {
  return rows
    .map((row, index) => ({ row, index }))
    .sort((left, right) => {
      const positionComparison = compareNumbers(
        normalizeCasePosition(left.row.position) ?? Number.POSITIVE_INFINITY,
        normalizeCasePosition(right.row.position) ?? Number.POSITIVE_INFINITY
      );
      if (positionComparison !== 0) return positionComparison;

      const idComparison = compareNumbers(
        normalizeCaseId(left.row.id) ?? Number.POSITIVE_INFINITY,
        normalizeCaseId(right.row.id) ?? Number.POSITIVE_INFINITY
      );
      return idComparison || left.index - right.index;
    })
    .map(({ row }) => row);
}

export function sortCasesByFolderPosition<T extends CaseFolderOrderRow>(rows: readonly T[]): T[] {
  return rows
    .map((row, index) => ({ row, index }))
    .sort((left, right) => {
      const folderComparison = compareNumbers(
        normalizeCaseId(left.row.folderId) ?? Number.POSITIVE_INFINITY,
        normalizeCaseId(right.row.folderId) ?? Number.POSITIVE_INFINITY
      );
      if (folderComparison !== 0) return folderComparison;

      const positionComparison = compareNumbers(
        normalizeCasePosition(left.row.position) ?? Number.POSITIVE_INFINITY,
        normalizeCasePosition(right.row.position) ?? Number.POSITIVE_INFINITY
      );
      if (positionComparison !== 0) return positionComparison;

      const idComparison = compareNumbers(
        normalizeCaseId(left.row.id) ?? Number.POSITIVE_INFINITY,
        normalizeCaseId(right.row.id) ?? Number.POSITIVE_INFINITY
      );
      return idComparison || left.index - right.index;
    })
    .map(({ row }) => row);
}

export function isCanonicalCaseOrderView(view: CaseOrderingView = {}): boolean {
  if (view.isFiltered) return false;
  if (!view.sortDescriptor) return true;

  return (
    view.sortDescriptor.column === CANONICAL_CASE_SORT.column &&
    (view.sortDescriptor.direction === CANONICAL_CASE_SORT.direction || view.sortDescriptor.direction === 'asc')
  );
}

function canonicalRows<T extends CaseOrderRow>(rows: readonly T[]): T[] | null {
  if (!Array.isArray(rows) || rows.length === 0) return null;

  const ids = rows.map((row) => normalizeCaseId(row.id));
  const positions = rows.map((row) => normalizeCasePosition(row.position));
  if (ids.some((id) => id === undefined) || positions.some((position) => position === undefined)) return null;
  if (new Set(ids).size !== ids.length || new Set(positions).size !== positions.length) return null;

  return sortCasesByPosition(rows);
}

/**
 * Returns a complete folder permutation for a drop before targetCaseId.
 * Null means the view or input is not safe for a complete reorder, or the drop changes nothing.
 */
export function computeCaseDragPermutation<T extends CaseOrderRow>(
  rows: readonly T[],
  sourceCaseId: number,
  targetCaseId: number,
  options: CaseDragOptions = {}
): number[] | null {
  if (!isCanonicalCaseOrderView(options)) return null;

  const orderedRows = canonicalRows(rows);
  const sourceId = normalizeCaseId(sourceCaseId);
  const targetId = normalizeCaseId(targetCaseId);
  if (!orderedRows || sourceId === undefined || targetId === undefined) return null;

  const rowIds = orderedRows.map((row) => normalizeCaseId(row.id) as number);
  if (!rowIds.includes(sourceId) || !rowIds.includes(targetId)) return null;

  const selectedIds = options.selectedCaseIds === undefined ? [sourceId] : Array.from(options.selectedCaseIds);
  const normalizedSelectedIds = selectedIds.map(normalizeCaseId);
  if (
    selectedIds.length === 0 ||
    normalizedSelectedIds.some((id) => id === undefined) ||
    new Set(normalizedSelectedIds).size !== normalizedSelectedIds.length ||
    !normalizedSelectedIds.includes(sourceId)
  ) {
    return null;
  }

  const selectedIdSet = new Set(normalizedSelectedIds as number[]);
  if (selectedIdSet.has(targetId)) return null;

  const selectedRows = orderedRows.filter((row) => selectedIdSet.has(normalizeCaseId(row.id) as number));
  if (selectedRows.length !== selectedIdSet.size) return null;

  const remainingRows = orderedRows.filter((row) => !selectedIdSet.has(normalizeCaseId(row.id) as number));
  const targetIndex = remainingRows.findIndex((row) => normalizeCaseId(row.id) === targetId);
  if (targetIndex < 0) return null;

  const nextRows = [...remainingRows.slice(0, targetIndex), ...selectedRows, ...remainingRows.slice(targetIndex)];
  const nextIds = nextRows.map((row) => normalizeCaseId(row.id) as number);
  return nextIds.every((id, index) => id === rowIds[index]) ? null : nextIds;
}
