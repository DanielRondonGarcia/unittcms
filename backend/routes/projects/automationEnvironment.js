import express from 'express';
import { DataTypes } from 'sequelize';
import defineTestEnvironment from '../../models/testEnvironments.js';
import authMiddleware from '../../middleware/auth.js';
import editableMiddleware from '../../middleware/verifyEditable.js';
import { normalizeEnvironmentTarget, normalizeHostList } from '../../automation/compatibility/hercules.js';

const router = express.Router();
const PUBLIC_ENVIRONMENT_ERRORS = new Set([
  'environment_url_invalid',
  'environment_target_rejected',
  'environment_hosts_invalid',
  'environment_host_invalid',
  'environment_host_unsafe',
]);

function publicEnvironmentError(error) {
  const code = error && typeof error.code === 'string' ? error.code : error?.message;
  return PUBLIC_ENVIRONMENT_ERRORS.has(code) ? code : 'environment_target_rejected';
}

function validationError(field, error) {
  const wrapped = new Error(publicEnvironmentError(error));
  wrapped.code = publicEnvironmentError(error);
  wrapped.field = field;
  return wrapped;
}

function publicEnvironmentErrorResponse(error) {
  const code = publicEnvironmentError(error);
  const field = error && typeof error.field === 'string' ? error.field : 'baseUrl';
  const message =
    field === 'allowedHosts'
      ? code === 'environment_host_unsafe'
        ? 'Use a public hostname that is not local, private, or reserved.'
        : 'Enter an exact hostname or an HTTP(S) origin with only an optional / path.'
      : code === 'environment_url_invalid'
        ? 'Enter a valid HTTP(S) project URL.'
        : 'Use an approved HTTP(S) project URL.';
  return {
    error: code,
    fields: [{ field, code, message }],
  };
}

function normalizeEnvironmentRequest(baseUrl, allowedHosts) {
  try {
    normalizeEnvironmentTarget(baseUrl);
  } catch (error) {
    throw validationError('baseUrl', error);
  }

  let configuredHosts;
  try {
    configuredHosts = allowedHosts === undefined ? [] : normalizeHostList(allowedHosts);
  } catch (error) {
    throw validationError('allowedHosts', error);
  }

  try {
    return normalizeEnvironmentTarget(baseUrl, configuredHosts);
  } catch (error) {
    throw validationError('allowedHosts', error);
  }
}

function normalizeStoredEnvironment(environment) {
  const base = normalizeEnvironmentTarget(environment.baseUrl);
  const configuredHosts = normalizeHostList(Array.isArray(environment.allowedHosts) ? environment.allowedHosts : []);
  if (configuredHosts.length > 0 && !configuredHosts.includes(base.allowedHosts[0]))
    throw new Error('environment_target_rejected');
  return normalizeEnvironmentTarget(environment.baseUrl, configuredHosts);
}

function safeEnvironment(environment, target) {
  if (!environment) return null;
  return {
    id: environment.id,
    projectId: environment.projectId,
    name: environment.name,
    baseUrl: target.baseUrl,
    allowedHosts: [...target.allowedHosts],
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
        const record = environment?.get({ plain: true });
        res.json({ environment: record ? safeEnvironment(record, normalizeStoredEnvironment(record)) : null });
      } catch (error) {
        res.status(500).json({ error: publicEnvironmentError(error) });
      }
    }
  );

  router.put(
    '/:projectId/settings/automation-environment',
    verifySignedIn,
    verifyProjectManagerFromProjectId,
    async (req, res) => {
      const { baseUrl, allowedHosts, enabled, captureVideo } = req.body ?? {};
      let target;
      try {
        target = normalizeEnvironmentRequest(baseUrl, allowedHosts);
      } catch (error) {
        return res.status(400).json(publicEnvironmentErrorResponse(error));
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
        res.json({ environment: safeEnvironment(environment.get({ plain: true }), target) });
      } catch {
        res.status(500).json({ error: 'Internal server error' });
      }
    }
  );

  return router;
}
