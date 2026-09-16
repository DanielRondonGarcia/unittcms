import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { randomUUID } from 'crypto';
import multer from 'multer';
import express from 'express';
const router = express.Router();
import { DataTypes } from 'sequelize';
import defineAttachment from '../../models/attachments.js';
import defineCaseAttachment from '../../models/caseAttachments.js';
import authMiddleware from '../../middleware/auth.js';
import editableMiddleware from '../../middleware/verifyEditable.js';
import {
  MAX_ATTACHMENT_FILE_SIZE,
  MAX_ATTACHMENT_FILES,
  validateAttachment,
  isAllowedAttachment,
} from '../../config/attachmentPolicy.js';
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const uploadDir = path.resolve(__dirname, '../../public/uploads');

const fileFilter = (req, file, cb) => {
  if (isAllowedAttachment(file)) {
    cb(null, true);
    return;
  }

  cb(new Error('Unsupported attachment type'));
};

const upload = multer({
  storage: multer.memoryStorage(),
  fileFilter,
  limits: {
    fileSize: MAX_ATTACHMENT_FILE_SIZE,
    files: MAX_ATTACHMENT_FILES,
  },
});

function parseUploadError(error) {
  if (error instanceof multer.MulterError) {
    if (error.code === 'LIMIT_FILE_SIZE') return 'Attachment exceeds the 50 MB file size limit';
    if (error.code === 'LIMIT_FILE_COUNT' || error.code === 'LIMIT_UNEXPECTED_FILE') {
      return 'Attachment upload exceeds the 10 file limit';
    }
  }

  return 'Invalid attachment upload';
}

function uploadMiddleware(req, res, next) {
  upload.array('files', MAX_ATTACHMENT_FILES)(req, res, (error) => {
    if (error) {
      return res.status(400).json({ error: parseUploadError(error) });
    }

    return next();
  });
}

async function removeStagedFiles(stagedFiles) {
  await Promise.allSettled(stagedFiles.map((filePath) => fs.promises.unlink(filePath)));
}

export default function (sequelize) {
  const Attachment = defineAttachment(sequelize, DataTypes);
  const CaseAttachment = defineCaseAttachment(sequelize, DataTypes);

  const { verifySignedIn } = authMiddleware(sequelize);
  const { verifyProjectDeveloperFromParentCaseId } = editableMiddleware(sequelize);

  router.post('/', verifySignedIn, verifyProjectDeveloperFromParentCaseId, uploadMiddleware, async (req, res) => {
    const caseId = req.query.parentCaseId;
    const files = Array.isArray(req.files) ? req.files : [];
    const stagedFiles = [];

    if (files.length === 0) {
      return res.status(400).json({ error: 'No files uploaded' });
    }

    const policies = files.map((file) => validateAttachment(file, file.buffer));
    if (policies.some((policy) => !policy)) {
      return res.status(400).json({ error: 'Unsupported attachment content' });
    }

    try {
      await fs.promises.mkdir(uploadDir, { recursive: true });

      const attachmentsData = [];
      for (const [index, file] of files.entries()) {
        const storedFilename = `${randomUUID()}${policies[index].extension}`;
        const filePath = path.join(uploadDir, storedFilename);
        stagedFiles.push(filePath);
        await fs.promises.writeFile(filePath, file.buffer, { flag: 'wx' });
        attachmentsData.push({
          title: file.originalname,
          filename: storedFilename,
        });
      }

      const t = await sequelize.transaction();
      try {
        const newAttachments = await Attachment.bulkCreate(attachmentsData, {
          transaction: t,
        });

        const caseAttachmentsData = newAttachments.map((attachment) => ({
          caseId,
          attachmentId: attachment.id,
        }));
        await CaseAttachment.bulkCreate(caseAttachmentsData, { transaction: t });
        await t.commit();
        return res.json(newAttachments);
      } catch (error) {
        await t.rollback();
        throw error;
      }
    } catch (error) {
      await removeStagedFiles(stagedFiles);
      console.error(error);
      return res.status(500).json({ error: 'Internal server error' });
    }
  });

  return router;
}
