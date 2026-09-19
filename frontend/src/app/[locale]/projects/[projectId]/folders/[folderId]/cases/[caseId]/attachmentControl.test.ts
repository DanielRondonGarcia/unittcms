// @vitest-environment happy-dom
import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import {
  fetchAttachmentPreview,
  fetchCreateAttachments,
  fetchDeleteAttachment,
  fetchDownloadAttachment,
} from './attachmentControl';
import CaseAttachmentsEditor from './CaseAttachmentsEditor';
import { isImage } from './isImage';
import type { AttachmentType, CaseMessages } from '@/types/case';

vi.mock('@heroui/react', () => ({
  Image: ({ alt, src }: { alt?: string; src?: string }) => React.createElement('img', { alt, src }),
  Button: ({
    children,
    onPress,
    isDisabled,
  }: {
    children?: React.ReactNode;
    onPress?: () => void;
    isDisabled?: boolean;
  }) => React.createElement('button', { type: 'button', disabled: isDisabled, onClick: onPress }, children),
  Tooltip: ({ children }: { children?: React.ReactNode }) => React.createElement(React.Fragment, null, children),
  Card: ({ children }: { children?: React.ReactNode }) => React.createElement('div', null, children),
  CardBody: ({ children }: { children?: React.ReactNode }) => React.createElement('div', null, children),
}));

vi.mock('lucide-react', () => ({
  Trash: () => React.createElement('span'),
  ArrowDownToLine: () => React.createElement('span'),
  ArrowUpFromLine: () => React.createElement('span'),
}));

describe('attachment control', () => {
  const fetchMock = vi.fn();
  const nativeCreateObjectURL = URL.createObjectURL;
  const nativeRevokeObjectURL = URL.revokeObjectURL;
  const mountedRoots: { root: ReturnType<typeof createRoot>; container: HTMLDivElement }[] = [];

  const editorMessages = {
    delete: 'Delete',
    download: 'Download',
    clickToUpload: 'Click to upload',
    orDragAndDrop: ' or drag and drop',
    maxFileSize: 'Maximum file size',
  } as CaseMessages;

  async function settle() {
    for (let index = 0; index < 8; index += 1) {
      await Promise.resolve();
    }
  }

  async function renderEditor(attachments: AttachmentType[]) {
    const container = document.createElement('div');
    document.body.appendChild(container);
    const root = createRoot(container);
    mountedRoots.push({ root, container });

    await act(async () => {
      root.render(
        React.createElement(CaseAttachmentsEditor, {
          isDisabled: false,
          token: 'preview-token',
          attachments,
          onAttachmentDownload: vi.fn(),
          onAttachmentDelete: vi.fn(),
          onFilesDrop: vi.fn(),
          onFilesInput: vi.fn(),
          messages: editorMessages,
        })
      );
      await settle();
    });

    return container;
  }

  beforeEach(() => {
    (globalThis as typeof globalThis & { React: typeof React }).React = React;
    (globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  });

  afterEach(() => {
    act(() => {
      for (const { root, container } of mountedRoots.splice(0)) {
        root.unmount();
        container.remove();
      }
    });
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

  test.each([401, 403, 404])(
    'renders no raster preview bytes when the authenticated preview returns %s',
    async (status) => {
      vi.stubGlobal('fetch', fetchMock);
      vi.spyOn(console, 'error').mockImplementation(() => {});
      const createObjectURL = vi.fn(() => 'blob:preview');
      Object.defineProperty(URL, 'createObjectURL', { configurable: true, writable: true, value: createObjectURL });
      fetchMock.mockResolvedValue({ ok: false, status });

      const container = await renderEditor([createAttachment('photo.png')]);

      expect(fetchMock).toHaveBeenCalledWith('/api/attachments/download/1', {
        method: 'GET',
        headers: { Authorization: 'Bearer preview-token' },
      });
      expect(createObjectURL).not.toHaveBeenCalled();
      expect(container.querySelector('img')).toBeNull();
    }
  );
});
