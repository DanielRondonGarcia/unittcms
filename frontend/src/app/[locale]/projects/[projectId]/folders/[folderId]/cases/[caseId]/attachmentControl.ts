import Config from '@/config/config';
import { logError } from '@/utils/errorHandler';
const apiServer = Config.apiServer;

async function fetchDownloadAttachment(jwt: string, attachmentId: number, downloadFileName: string) {
  const url = `${apiServer}/attachments/download/${attachmentId}`;
  let downloadUrl: string | undefined;

  try {
    const response = await fetch(url, {
      method: 'GET',
      headers: {
        Authorization: `Bearer ${jwt}`,
        'Content-Type': 'application/json',
      },
    });
    if (!response.ok) {
      throw new Error(`HTTP error! Status: ${response.status}`);
    }

    const blob = await response.blob();
    downloadUrl = window.URL.createObjectURL(blob);

    const link = document.createElement('a');
    link.href = downloadUrl;
    link.download = downloadFileName;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  } catch (error: unknown) {
    logError('Error downloading attachment', error);
    throw error;
  } finally {
    if (downloadUrl) {
      window.URL.revokeObjectURL(downloadUrl);
    }
  }
}

async function fetchCreateAttachments(jwt: string, caseId: number, files: File[]) {
  try {
    const formData = new FormData();
    for (let i = 0; i < files.length; i++) {
      formData.append('files', files[i]);
    }

    const url = `${apiServer}/attachments?parentCaseId=${caseId}`;
    const response = await fetch(url, {
      method: 'POST',
      body: formData,
      headers: {
        Authorization: `Bearer ${jwt}`,
      },
    });

    if (!response.ok) {
      throw new Error('Network response was not ok');
    }

    const responseData = await response.json();
    return responseData;
  } catch (error: unknown) {
    logError('Error uploading files', error);
  }
}

async function fetchDeleteAttachment(jwt: string, attachmentId: number) {
  const url = `${apiServer}/attachments/${attachmentId}`;

  try {
    const response = await fetch(url, {
      method: 'DELETE',
      headers: {
        Authorization: `Bearer ${jwt}`,
        'Content-Type': 'application/json',
      },
    });
    if (!response.ok) {
      throw new Error(`HTTP error! Status: ${response.status}`);
    }
  } catch (error: unknown) {
    logError('Error deleting file:', error);
    throw error;
  }
}

async function fetchAttachmentPreview(jwt: string, attachmentId: number): Promise<Blob> {
  const url = `${apiServer}/attachments/download/${attachmentId}`;

  try {
    const response = await fetch(url, {
      method: 'GET',
      headers: {
        Authorization: `Bearer ${jwt}`,
      },
    });
    if (!response.ok) {
      throw new Error(`HTTP error! Status: ${response.status}`);
    }

    return await response.blob();
  } catch (error: unknown) {
    logError('Error previewing attachment', error);
    throw error;
  }
}

export { fetchDownloadAttachment, fetchCreateAttachments, fetchDeleteAttachment, fetchAttachmentPreview };
