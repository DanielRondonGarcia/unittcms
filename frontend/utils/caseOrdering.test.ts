import { describe, expect, it } from 'vitest';
import {
  computeCaseDragPermutation,
  normalizeCasePosition,
  sortCasesByFolderPosition,
  sortCasesByPosition,
} from './caseOrdering';

const canonicalView = {
  sortDescriptor: { column: 'position', direction: 'ascending' },
};

function rows(ids: number[], positions = ids.map((_id, index) => index + 1)) {
  return ids.map((id, index) => ({ id, position: positions[index] }));
}

describe('case ordering helpers', () => {
  it('normalizes optional one-based positions without accepting invalid values', () => {
    expect(normalizeCasePosition('3')).toBe(3);
    expect(normalizeCasePosition(4)).toBe(4);
    expect(normalizeCasePosition(undefined)).toBeUndefined();
    expect(normalizeCasePosition(0)).toBeUndefined();
    expect(normalizeCasePosition(-1)).toBeUndefined();
    expect(normalizeCasePosition('not-a-position')).toBeUndefined();
  });

  it('sorts by position first and id second without mutating the input', () => {
    const input = [
      { id: 10, position: 2 },
      { id: 3, position: 1 },
      { id: 2, position: 1 },
    ];

    expect(sortCasesByPosition(input).map((row) => row.id)).toEqual([2, 3, 10]);
    expect(input.map((row) => row.id)).toEqual([10, 3, 2]);
  });

  it('sorts selector rows by folder, position, and id', () => {
    const input = [
      { id: 10, folderId: 2, position: 2 },
      { id: 3, folderId: 1, position: 1 },
      { id: 2, folderId: 1, position: 1 },
    ];

    expect(sortCasesByFolderPosition(input).map((row) => row.id)).toEqual([2, 3, 10]);
  });

  it('moves case 10 to the third position as a complete permutation', () => {
    expect(computeCaseDragPermutation(rows([1, 2, 3, 10, 4]), 10, 3, canonicalView)).toEqual([1, 2, 10, 3, 4]);
  });

  it('accepts sparse positive positions and returns a complete permutation', () => {
    expect(computeCaseDragPermutation(rows([1, 18], [1, 18]), 18, 1, canonicalView)).toEqual([18, 1]);
  });

  it('rejects duplicate positions', () => {
    expect(
      computeCaseDragPermutation(
        [
          { id: 1, position: 1 },
          { id: 18, position: 1 },
        ],
        18,
        1,
        canonicalView
      )
    ).toBeNull();
  });

  it.each([Number.NaN, 0, -1])('rejects invalid or non-positive positions: %s', (position) => {
    expect(
      computeCaseDragPermutation(
        [
          { id: 1, position: 1 },
          { id: 18, position },
        ],
        18,
        1,
        canonicalView
      )
    ).toBeNull();
  });

  it('keeps multiple selected rows together in canonical order', () => {
    expect(
      computeCaseDragPermutation(rows([1, 2, 3, 4, 5, 6]), 4, 6, {
        ...canonicalView,
        selectedCaseIds: [4, 2],
      })
    ).toEqual([1, 3, 5, 2, 4, 6]);
  });

  it('refuses filtered, alternate-sort, and missing-position views', () => {
    const completeRows = rows([1, 2, 3, 10]);
    expect(computeCaseDragPermutation(completeRows, 10, 2, { ...canonicalView, isFiltered: true })).toBeNull();
    expect(
      computeCaseDragPermutation(completeRows, 10, 2, {
        sortDescriptor: { column: 'id', direction: 'ascending' },
      })
    ).toBeNull();
    expect(computeCaseDragPermutation([{ id: 1, position: 1 }, { id: 3 }], 3, 1, canonicalView)).toBeNull();
  });

  it('returns no result for invalid ids, duplicate rows, or unchanged drops', () => {
    expect(computeCaseDragPermutation(rows([1, 2, 3]), 0, 2, canonicalView)).toBeNull();
    expect(computeCaseDragPermutation(rows([1, 1, 3]), 1, 3, canonicalView)).toBeNull();
    expect(computeCaseDragPermutation(rows([1, 2, 3]), 2, 2, canonicalView)).toBeNull();
    expect(
      computeCaseDragPermutation(rows([1, 2, 3]), 2, 3, {
        ...canonicalView,
        selectedCaseIds: [2, 99],
      })
    ).toBeNull();
  });
});
