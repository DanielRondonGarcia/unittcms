import { describe, it, expect, vi, beforeEach } from 'vitest';
import request from 'supertest';
import express from 'express';
import { Sequelize } from 'sequelize';
import XLSX from 'xlsx';
import casesImportRoute from './import.js';

vi.mock('xlsx', () => ({
  default: {
    read: vi.fn(),
    utils: { sheet_to_json: vi.fn() },
  },
}));

vi.mock('../../middleware/auth.js', () => ({
  default: () => ({
    verifySignedIn: vi.fn((req, res, next) => {
      req.userId = 1;
      next();
    }),
  }),
}));

vi.mock('../../middleware/verifyEditable.js', () => ({
  default: () => ({
    verifyProjectDeveloperFromFolderId: vi.fn((req, res, next) => next()),
  }),
}));

const mockCase = { bulkCreate: vi.fn(), findAll: vi.fn(), update: vi.fn(), belongsToMany: vi.fn() };
vi.mock('../../models/cases.js', () => ({ default: () => mockCase }));

const mockFolder = { findByPk: vi.fn() };
vi.mock('../../models/folders.js', () => ({ default: () => mockFolder }));

const mockStep = { create: vi.fn(), belongsToMany: vi.fn() };
vi.mock('../../models/steps.js', () => ({ default: () => mockStep }));

const mockCaseStep = { create: vi.fn() };
vi.mock('../../models/caseSteps.js', () => ({ default: () => mockCaseStep }));

const FAKE_XLSX_BUFFER = Buffer.from('fake');
const XLSX_CONTENT_TYPE = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';

const validRow = {
  title: 'Test Case',
  priority: 'medium',
  type: 'other',
  template: 'text',
};

describe('Test case import strict validation', () => {
  let app;

  beforeEach(() => {
    const sequelize = new Sequelize({ dialect: 'sqlite', logging: false });
    app = express();
    app.use(express.json());
    app.use('/', casesImportRoute(sequelize));
    vi.clearAllMocks();
    mockFolder.findByPk.mockResolvedValue({ id: 1 });
    mockCase.findAll.mockResolvedValue([]);
    mockCase.update.mockResolvedValue([1]);
  });

  const postImport = (rows) => {
    XLSX.read.mockReturnValue({ SheetNames: ['Sheet1'], Sheets: { Sheet1: {} } });
    XLSX.utils.sheet_to_json.mockReturnValue(rows);
    return request(app)
      .post('/import?folderId=1')
      .attach('file', FAKE_XLSX_BUFFER, { filename: 'test.xlsx', contentType: XLSX_CONTENT_TYPE });
  };

  describe('Happy path', () => {
    it('should return 200 for valid row', async () => {
      mockCase.bulkCreate.mockResolvedValue([{ id: 1, title: 'Test Case' }]);
      mockStep.create.mockResolvedValue({ id: 1 });
      mockCaseStep.create.mockResolvedValue({ id: 1 });
      const res = await postImport([{ ...validRow }]);
      expect(res.status).toBe(200);
    });

    it('appends distinct cases in input order without consuming positions for step rows', async () => {
      const existingCases = [
        { id: 10, folderId: 1, position: 7 },
        { id: 11, folderId: 1, position: 12 },
      ];
      mockCase.findAll.mockResolvedValue(existingCases);
      mockCase.bulkCreate.mockResolvedValue([
        { id: 20, template: 1, title: 'First' },
        { id: 21, template: 1, title: 'Second' },
      ]);
      mockStep.create
        .mockResolvedValueOnce({ id: 1 })
        .mockResolvedValueOnce({ id: 2 })
        .mockResolvedValueOnce({ id: 3 });
      mockCaseStep.create.mockResolvedValue({ id: 1 });

      const res = await postImport([
        { ...validRow, title: 'First', step: 'first step' },
        { ...validRow, title: 'First', step: 'second step' },
        { ...validRow, title: 'Second', step: 'third step' },
      ]);

      expect(res.status).toBe(200);
      expect(mockCase.bulkCreate).toHaveBeenCalledWith(
        [
          expect.objectContaining({ title: 'First', position: 3 }),
          expect.objectContaining({ title: 'Second', position: 4 }),
        ],
        expect.objectContaining({ transaction: expect.anything() })
      );
      expect(mockCaseStep.create.mock.calls.map(([attributes]) => attributes)).toEqual([
        expect.objectContaining({ caseId: 20, stepNo: 1 }),
        expect.objectContaining({ caseId: 20, stepNo: 2 }),
        expect.objectContaining({ caseId: 21, stepNo: 1 }),
      ]);
      expect(mockCase.update.mock.calls.map(([attributes]) => attributes.position)).toEqual([-1, -2, 1, 2]);
    });

    it('keeps Gherkin step metadata while appending the case once', async () => {
      mockCase.bulkCreate.mockResolvedValue([{ id: 30, template: 2, title: 'Login' }]);
      mockStep.create.mockResolvedValue({ id: 4 });
      mockCaseStep.create.mockResolvedValue({ id: 4 });

      const res = await postImport([
        {
          ...validRow,
          title: 'Login',
          template: 'gherkin',
          keyword: 'given',
          section: 'background',
          step: 'the user is signed out',
        },
        {
          ...validRow,
          title: 'Login',
          template: 'gherkin',
          keyword: 'then',
          section: 'scenario',
          step: 'the dashboard is shown',
        },
      ]);

      expect(res.status).toBe(200);
      expect(mockCase.bulkCreate).toHaveBeenCalledWith(
        [expect.objectContaining({ title: 'Login', template: 2, position: 1 })],
        expect.objectContaining({ transaction: expect.anything() })
      );
      expect(mockCaseStep.create).toHaveBeenNthCalledWith(
        1,
        expect.objectContaining({ caseId: 30, stepNo: 1, keyword: 'given', section: 'scenario' }),
        expect.objectContaining({ transaction: expect.anything() })
      );
      expect(mockCaseStep.create).toHaveBeenNthCalledWith(
        2,
        expect.objectContaining({ caseId: 30, stepNo: 2, keyword: 'then', section: 'scenario' }),
        expect.objectContaining({ transaction: expect.anything() })
      );
    });
  });

  describe('Abnormal priority', () => {
    it('should return 400 for "Medium" (wrong casing)', async () => {
      const res = await postImport([{ ...validRow, priority: 'Medium' }]);
      expect(res.status).toBe(400);
      expect(res.body.error).toContain('invalid priority');
      expect(res.body.error).toContain('Medium');
    });

    it('should return 400 for "HIGH" (all caps)', async () => {
      const res = await postImport([{ ...validRow, priority: 'HIGH' }]);
      expect(res.status).toBe(400);
      expect(res.body.error).toContain('invalid priority');
    });

    it('should return 400 for a completely unknown priority value', async () => {
      const res = await postImport([{ ...validRow, priority: 'urgent' }]);
      expect(res.status).toBe(400);
      expect(res.body.error).toContain('invalid priority');
    });
  });

  describe('Invalid type', () => {
    it('should return 400 for "Other" (wrong casing)', async () => {
      const res = await postImport([{ ...validRow, type: 'Other' }]);
      expect(res.status).toBe(400);
      expect(res.body.error).toContain('invalid type');
    });

    it('should return 400 for a completely unknown type value', async () => {
      const res = await postImport([{ ...validRow, type: 'integration' }]);
      expect(res.status).toBe(400);
      expect(res.body.error).toContain('invalid type');
    });
  });

  describe('automationStatus field', () => {
    it('should return 400 for "Automated" (wrong casing)', async () => {
      const res = await postImport([{ ...validRow, automationStatus: 'Automated' }]);
      expect(res.status).toBe(400);
      expect(res.body.error).toContain('invalid automationStatus');
    });

    it('should return 400 for a completely unknown automationStatus value', async () => {
      const res = await postImport([{ ...validRow, automationStatus: 'unknown' }]);
      expect(res.status).toBe(400);
      expect(res.body.error).toContain('invalid automationStatus');
    });
  });

  describe('template field', () => {
    it('should return 400 for "Text" (wrong casing)', async () => {
      const res = await postImport([{ ...validRow, template: 'Text' }]);
      expect(res.status).toBe(400);
      expect(res.body.error).toContain('invalid template');
    });

    it('should return 400 for "Step" (wrong casing)', async () => {
      const res = await postImport([{ ...validRow, template: 'Step' }]);
      expect(res.status).toBe(400);
      expect(res.body.error).toContain('invalid template');
    });

    it('should return 400 for a completely unknown template value', async () => {
      const res = await postImport([{ ...validRow, template: 'unknown' }]);
      expect(res.status).toBe(400);
      expect(res.body.error).toContain('invalid template');
    });
  });

  describe('error message should include the row number', () => {
    it('should report row 2 for the first data row', async () => {
      const res = await postImport([{ ...validRow, priority: 'Medium' }]);
      expect(res.body.error).toContain('Row 2');
    });

    it('should report row 3 for the second data row when first row is valid', async () => {
      const res = await postImport([{ ...validRow }, { ...validRow, priority: 'Medium' }]);
      expect(res.body.error).toContain('Row 3');
    });
  });
});
