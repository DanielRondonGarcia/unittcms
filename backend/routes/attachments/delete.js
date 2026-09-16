import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import express from 'express';
const router = express.Router();
import { DataTypes } from 'sequelize';
import defineAttachment from '../../models/attachments.js';
import authMiddleware from '../../middleware/auth.js';
import editableMiddleware from '../../middleware/verifyEditable.js';
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
  const { verifyProjectDeveloperFromAttachmentId } = editableMiddleware(sequelize);

  router.delete('/:attachmentId', verifySignedIn, verifyProjectDeveloperFromAttachmentId, async (req, res) => {
    const attachmentId = req.params.attachmentId;
    let t;

    try {
      const attachment = await Attachment.findByPk(attachmentId);
      if (!attachment) {
        return res.status(404).json({ error: 'Not found' });
      }

      const filePath = resolveUploadPath(attachment.filename);
      if (!filePath) {
        return res.status(500).json({ error: 'Internal server error' });
      }

      t = await sequelize.transaction();
      await fs.promises.unlink(filePath);
      await attachment.destroy({ transaction: t });
      await t.commit();
      return res.status(204).send();
    } catch (error) {
      if (t) {
        await Promise.resolve(t.rollback()).catch((rollbackError) => console.error(rollbackError));
      }
      console.error(error);
      return res.status(500).json({ error: 'Internal server error' });
    }
  });

  return router;
}
