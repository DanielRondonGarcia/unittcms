import express from 'express';
import { DataTypes } from 'sequelize';
import defineTestEnvironment from '../../models/testEnvironments.js';
import authMiddleware from '../../middleware/auth.js';
import editableMiddleware from '../../middleware/verifyEditable.js';
import { normalizeEnvironmentTarget } from '../../automation/compatibility/hercules.js';

const router = express.Router();

function safeEnvironment(environment) {
  if (!environment) return null;
  return {
    id: environment.id,
    projectId: environment.projectId,
    name: environment.name,
    baseUrl: environment.baseUrl,
    enabled: environment.enabled !== false,
    isDefault: environment.isDefault === true,
    captureVideo: environment.captureVideo === true,
    hasSecretRefs: Array.isArray(environment.secretRefs) && environment.secretRefs.length > 0,
  };
}

export default function (sequelize) {
  const { verifySignedIn } = authMiddleware(sequelize);
  const { verifyProjectManagerFromProjectId } = editableMiddleware(sequelize);
  const TestEnvironment = defineTestEnvironment(sequelize, DataTypes);

  router.get(
    '/:projectId/settings/automation-environment',
    verifySignedIn,
    verifyProjectManagerFromProjectId,
    async (req, res) => {
      try {
        const environment = await TestEnvironment.findOne({
          where: { projectId: req.params.projectId, isDefault: true },
        });
        res.json({ environment: safeEnvironment(environment?.get({ plain: true })) });
      } catch {
        res.status(500).json({ error: 'Internal server error' });
      }
    }
  );

  router.put(
    '/:projectId/settings/automation-environment',
    verifySignedIn,
    verifyProjectManagerFromProjectId,
    async (req, res) => {
      const { baseUrl, enabled, captureVideo } = req.body ?? {};
      let target;
      try {
        target = normalizeEnvironmentTarget(baseUrl);
      } catch (error) {
        return res.status(400).json({ error: error instanceof Error ? error.message : 'environment_url_invalid' });
      }

      try {
        const projectId = Number(req.params.projectId);
        const values = {
          projectId,
          name: 'Default',
          baseUrl: target.baseUrl,
          allowedHosts: target.allowedHosts,
          enabled: enabled !== false,
          isDefault: true,
          captureVideo: captureVideo === true,
        };
        const [environment] = await TestEnvironment.findOrCreate({
          where: { projectId, isDefault: true },
          defaults: { ...values, secretRefs: [] },
        });
        await environment.update({
          baseUrl: values.baseUrl,
          allowedHosts: values.allowedHosts,
          enabled: values.enabled,
          isDefault: true,
          captureVideo: values.captureVideo,
        });
        res.json({ environment: safeEnvironment(environment.get({ plain: true })) });
      } catch {
        res.status(500).json({ error: 'Internal server error' });
      }
    }
  );

  return router;
}
