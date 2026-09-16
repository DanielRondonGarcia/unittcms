// @vitest-environment happy-dom
import { afterEach, describe, expect, test, vi } from 'vitest';
import {
  fetchAttachmentPreview,
  fetchCreateAttachments,
  fetchDeleteAttachment,
  fetchDownloadAttachment,
} from './attachmentControl';
import { isImage } from './isImage';
import { AttachmentType } from '@/types/case';

describe('attachment control', () => {
  const fetchMock = vi.fn();
  const nativeCreateObjectURL = URL.createObjectURL;
  const nativeRevokeObjectURL = URL.revokeObjectURL;

  afterEach(() => {
    fetchMock.mockReset();
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
    Object.defineProperty(URL, 'createObjectURL', {
      configurable: true,
      writable: true,
      value: nativeCreateObjectURL,
    });
    Object.defineProperty(URL, 'revokeObjectURL', {
      configurable: true,
      writable: true,
      value: nativeRevokeObjectURL,
    });
  });

  function createAttachment(filename: string): AttachmentType {
    type CaseAttachmentType = {
      createdAt: Date;
      updatedAt: Date;
      caseId: number;
      attachmentId: number;
    };

    const sampleCaseAttachment: CaseAttachmentType = {
      createdAt: new Date(),
      updatedAt: new Date(),
      caseId: 1,
      attachmentId: 1,
    };

    return {
      id: 1,
      title: '',
      detail: '',
      filename,
      createdAt: new Date(),
      updatedAt: new Date(),
      caseAttachments: sampleCaseAttachment,
    };
  }

  test('identifies allowed raster images and excludes SVG', () => {
    expect(isImage(createAttachment('abc.png'))).toBe(true);
    expect(isImage(createAttachment('abc.svg'))).toBe(false);
    expect(isImage(createAttachment('abc.mp3'))).toBe(false);
  });

  test('sends Bearer headers for upload, download, and delete', async () => {
    vi.stubGlobal('fetch', fetchMock);
    fetchMock
      .mockResolvedValueOnce({ ok: true, json: vi.fn().mockResolvedValue([]) })
      .mockResolvedValueOnce({ ok: true, blob: vi.fn().mockResolvedValue(new Blob(['file'])) })
      .mockResolvedValueOnce({ ok: true });

    await fetchCreateAttachments('upload-token', 1, [new File(['file'], 'file.png')]);
    await fetchDownloadAttachment('download-token', 2, 'file.png');
    await fetchDeleteAttachment('delete-token', 3);

    expect(fetchMock.mock.calls[0][1]).toMatchObject({
      method: 'POST',
      headers: { Authorization: 'Bearer upload-token' },
    });
    expect(fetchMock.mock.calls[0][1].headers).not.toHaveProperty('Content-Type');
    expect(fetchMock.mock.calls[1][1]).toMatchObject({
      method: 'GET',
      headers: {
        Authorization: 'Bearer download-token',
        'Content-Type': 'application/json',
      },
    });
    expect(fetchMock.mock.calls[2][1]).toMatchObject({
      method: 'DELETE',
      headers: {
        Authorization: 'Bearer delete-token',
        'Content-Type': 'application/json',
      },
    });
  });

  test('revokes the download ObjectURL after the link is used', async () => {
    vi.stubGlobal('fetch', fetchMock);
    const createObjectURL = vi.fn(() => 'blob:download');
    const revokeObjectURL = vi.fn();
    Object.defineProperty(URL, 'createObjectURL', { configurable: true, writable: true, value: createObjectURL });
    Object.defineProperty(URL, 'revokeObjectURL', { configurable: true, writable: true, value: revokeObjectURL });
    fetchMock.mockResolvedValue({ ok: true, blob: vi.fn().mockResolvedValue(new Blob(['file'])) });

    await fetchDownloadAttachment('token', 2, 'file.png');

    expect(createObjectURL).toHaveBeenCalledOnce();
    expect(revokeObjectURL).toHaveBeenCalledWith('blob:download');
  });

  test('rejects a failed authenticated preview without returning bytes', async () => {
    vi.stubGlobal('fetch', fetchMock);
    vi.spyOn(console, 'error').mockImplementation(() => {});
    fetchMock.mockResolvedValue({ ok: false, status: 403 });

    await expect(fetchAttachmentPreview('preview-token', 4)).rejects.toThrow('HTTP error! Status: 403');
    expect(fetchMock).toHaveBeenCalledWith('/api/attachments/download/4', {
      method: 'GET',
      headers: { Authorization: 'Bearer preview-token' },
    });
  });
});
