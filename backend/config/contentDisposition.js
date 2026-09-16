export function toSafeFileName(fileName) {
  const s = String(fileName ?? '')
    // eslint-disable-next-line no-control-regex
    .replace(/[\u0000-\u001F\u007F]/g, '')
    .replace(/[<>:"/\\|?*]/g, '_')
    .replace(/\s+/g, ' ')
    .trim();

  return s;
}

export function contentDisposition(filename, mode = 'attachment') {
  const safeFilename = toSafeFileName(filename) || 'download';
  const disposition = mode === 'inline' ? 'inline' : 'attachment';
  const fallback = safeFilename.replace(/[^\x20-\x7E]/g, '_').replace(/"/g, "'");
  const encoded = encodeURIComponent(safeFilename);
  return `${disposition}; filename="${fallback}"; filename*=UTF-8''${encoded}`;
}
