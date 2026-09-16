import path from 'path';

export const MAX_ATTACHMENT_FILE_SIZE = 50 * 1024 * 1024;
export const MAX_ATTACHMENT_FILES = 10;

export const ALLOWED_ATTACHMENT_MIME_TYPES = Object.freeze({
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.bmp': 'image/bmp',
  '.pdf': 'application/pdf',
  '.zip': 'application/zip',
});

export const REJECTED_ATTACHMENT_EXTENSIONS = new Set([
  '.htm',
  '.html',
  '.shtml',
  '.svg',
  '.svgz',
  '.xhtml',
  '.xml',
  '.xsd',
  '.xsl',
  '.xslt',
]);

export const REJECTED_ATTACHMENT_MIME_TYPES = new Set([
  'text/html',
  'text/xhtml',
  'image/svg+xml',
  'application/xhtml+xml',
  'text/xml',
  'application/xml',
  'application/xml-dtd',
  'application/xslt+xml',
  'application/ecmascript',
  'application/javascript',
  'text/javascript',
]);

export const INLINE_ATTACHMENT_MIME_TYPES = new Set(['image/png', 'image/jpeg', 'image/gif', 'image/bmp']);

const SIGNATURES = {
  'image/png': (bytes) => bytes.subarray(0, 8).equals(Buffer.from('89504e470d0a1a0a', 'hex')),
  'image/jpeg': (bytes) => bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff,
  'image/gif': (bytes) =>
    bytes.subarray(0, 6).toString('ascii') === 'GIF87a' || bytes.subarray(0, 6).toString('ascii') === 'GIF89a',
  'image/bmp': (bytes) => bytes.subarray(0, 2).toString('ascii') === 'BM',
  'application/pdf': (bytes) => bytes.subarray(0, 5).toString('ascii') === '%PDF-',
  'application/zip': (bytes) =>
    bytes.length >= 4 &&
    ((bytes[0] === 0x50 && bytes[1] === 0x4b && bytes[2] === 0x03 && bytes[3] === 0x04) ||
      (bytes[0] === 0x50 && bytes[1] === 0x4b && bytes[2] === 0x05 && bytes[3] === 0x06) ||
      (bytes[0] === 0x50 && bytes[1] === 0x4b && bytes[2] === 0x07 && bytes[3] === 0x08)),
};

export function normalizeAttachmentMimeType(mimeType) {
  return String(mimeType || '')
    .split(';', 1)[0]
    .trim()
    .toLowerCase();
}

export function getAttachmentPolicy(filename, mimeType) {
  const extension = path.extname(String(filename || '')).toLowerCase();
  const normalizedMimeType = normalizeAttachmentMimeType(mimeType);
  if (REJECTED_ATTACHMENT_EXTENSIONS.has(extension) || REJECTED_ATTACHMENT_MIME_TYPES.has(normalizedMimeType)) {
    return null;
  }
  if (ALLOWED_ATTACHMENT_MIME_TYPES[extension] !== normalizedMimeType) return null;
  return {
    extension,
    mimeType: normalizedMimeType,
    inline: INLINE_ATTACHMENT_MIME_TYPES.has(normalizedMimeType),
  };
}

export function hasValidAttachmentSignature(content, mimeType) {
  const signature = SIGNATURES[normalizeAttachmentMimeType(mimeType)];
  return Boolean(signature && signature(Buffer.from(content || [])));
}

export function validateAttachment(file, content) {
  const policy = getAttachmentPolicy(file?.originalname || file?.filename, file?.mimetype);
  return policy && hasValidAttachmentSignature(content, policy.mimeType) ? policy : null;
}

export function isAllowedAttachment(file) {
  return Boolean(getAttachmentPolicy(file?.originalname || file?.filename, file?.mimetype));
}
