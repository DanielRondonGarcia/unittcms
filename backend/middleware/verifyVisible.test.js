import { beforeEach, describe, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import verifyEditableMiddleware from './verifyEditable.js';
import verifyVisibleMiddleware from './verifyVisible.js';
import {
  MAX_ATTACHMENT_FILE_SIZE,
  MAX_ATTACHMENT_FILES,
  isAllowedAttachment,
  validateAttachment,
} from '../config/attachmentPolicy.js';

const model = {
  findByPk: vi.fn(),
  findOne: vi.fn(),
  hasMany: vi.fn(),
  belongsTo: vi.fn(),
};

vi.mock('../models/members.js', () => ({ default: () => model }));
vi.mock('../models/projects.js', () => ({ default: () => model }));
vi.mock('../models/folders.js', () => ({ default: () => model }));
vi.mock('../models/cases.js', () => ({ default: () => model }));
vi.mock('../models/caseAttachments.js', () => ({ default: () => model }));
vi.mock('../models/runs.js', () => ({ default: () => model }));
vi.mock('../models/runCases.js', () => ({ default: () => model }));

const response = () => ({
  status: vi.fn().mockReturnThis(),
  json: vi.fn().mockReturnThis(),
  send: vi.fn().mockReturnThis(),
});

describe('attachment security foundation', () => {
  beforeEach(() => vi.resetAllMocks());

  it('exposes bounded policy and rejects active content or bad signatures', () => {
    expect(MAX_ATTACHMENT_FILE_SIZE).toBe(50 * 1024 * 1024);
    expect(MAX_ATTACHMENT_FILES).toBe(10);
    expect(isAllowedAttachment({ originalname: 'photo.PNG', mimetype: 'image/png' })).toBe(true);
    expect(isAllowedAttachment({ originalname: 'page.svg', mimetype: 'image/svg+xml' })).toBe(false);
    expect(
      validateAttachment({ originalname: 'photo.png', mimetype: 'image/png' }, Buffer.from('not an image'))
    ).toBeNull();
    expect(
      validateAttachment({ originalname: 'photo.png', mimetype: 'image/png' }, Buffer.from('89504e470d0a1a0a', 'hex'))
    ).not.toBeNull();
  });

  it('resolves attachment access through case, folder, and project', async () => {
    model.findOne
      .mockResolvedValueOnce({ Case: { Folder: { Project: { id: 7 } } } })
      .mockResolvedValueOnce({ isPublic: true })
      .mockResolvedValueOnce({ Case: { Folder: { Project: { id: 7 } } } })
      .mockResolvedValueOnce({ userId: 3, Members: [] });
    const visibleNext = vi.fn();
    const editableNext = vi.fn();
    const visibleRes = response();
    const editableRes = response();

    await verifyVisibleMiddleware({}).verifyProjectVisibleFromAttachmentId(
      { params: { attachmentId: '9' }, query: {}, userId: 3 },
      visibleRes,
      visibleNext
    );
    await verifyEditableMiddleware({}).verifyProjectDeveloperFromAttachmentId(
      { params: { attachmentId: '9' }, query: {}, userId: 3 },
      editableRes,
      editableNext
    );

    expect(visibleNext).toHaveBeenCalledOnce();
    expect(editableNext).toHaveBeenCalledOnce();
  });

  it('resolves parentCaseId for developer authorization', async () => {
    model.findByPk.mockResolvedValueOnce({ Folder: { Project: { id: 8 } } });
    model.findOne.mockResolvedValueOnce({ userId: 4, Members: [] });
    const next = vi.fn();
    await verifyEditableMiddleware({}).verifyProjectDeveloperFromParentCaseId(
      { params: {}, query: { parentCaseId: '12' }, userId: 4 },
      response(),
      next
    );
    expect(next).toHaveBeenCalledOnce();
  });

  it('does not mount public static files while retaining Swagger setup', () => {
    const server = readFileSync(new URL('../server.ts', import.meta.url), 'utf8');
    expect(server).not.toContain("app.use(express.static(path.join(__dirname, 'public')));");
    expect(server).toContain("app.use('/api-docs', swaggerUi.serve, swaggerUi.setup(swaggerDocument));");
  });
});
