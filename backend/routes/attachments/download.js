import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import express from 'express';
const router = express.Router();
import { DataTypes } from 'sequelize';
import defineAttachment from '../../models/attachments.js';
import authMiddleware from '../../middleware/auth.js';
import visibilityMiddleware from '../../middleware/verifyVisible.js';
import { ALLOWED_ATTACHMENT_MIME_TYPES, getAttachmentPolicy } from '../../config/attachmentPolicy.js';
import { contentDisposition } from '../../config/contentDisposition.js';
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const uploadDir = path.resolve(__dirname, '../../public/uploads');

function resolveUploadPath(filename) {
  const resolvedUploadDir = path.resolve(uploadDir);
  const filePath = path.resolve(resolvedUploadDir, String(filename || ''));
  if (filePath === resolvedUploadDir || !filePath.startsWith(`${resolvedUploadDir}${path.sep}`)) {
    return null;
  }
  return filePath;
}

export default function (sequelize) {
  const Attachment = defineAttachment(sequelize, DataTypes);
  const { verifySignedIn } = authMiddleware(sequelize);
  const { verifyProjectVisibleFromAttachmentId } = visibilityMiddleware(sequelize);

  router.get('/download/:attachmentId', verifySignedIn, verifyProjectVisibleFromAttachmentId, async (req, res) => {
    const attachmentId = req.params.attachmentId;

    try {
      const attachment = await Attachment.findByPk(attachmentId);
      if (!attachment) {
        return res.status(404).json({ error: 'Not found' });
      }

      const extension = path.extname(String(attachment.filename || '')).toLowerCase();
      const policy = getAttachmentPolicy(attachment.filename, ALLOWED_ATTACHMENT_MIME_TYPES[extension]);
      const filePath = resolveUploadPath(attachment.filename);
      if (!policy || !filePath) {
        return res.status(404).json({ error: 'Not found' });
      }

      let file;
      try {
        file = await fs.promises.readFile(filePath);
      } catch (error) {
        if (error?.code === 'ENOENT' || error?.code === 'ENOTDIR') {
          return res.status(404).json({ error: 'Not found' });
        }
        throw error;
      }

      res.setHeader('Content-Type', policy.mimeType);
      res.setHeader('X-Content-Type-Options', 'nosniff');
      res.setHeader('Access-Control-Expose-Headers', 'Content-Disposition');
      res.setHeader(
        'Content-Disposition',
        contentDisposition(attachment.title || attachment.filename, policy.inline ? 'inline' : 'attachment')
      );
      return res.send(file);
    } catch (error) {
      console.error(error);
      return res.status(500).json({ error: 'Internal server error' });
    }
  });

  return router;
}
