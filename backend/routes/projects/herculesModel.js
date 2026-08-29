import express from 'express';
import { DataTypes } from 'sequelize';
import defineOrganization from '../../models/organizations.js';
import defineProject from '../../models/projects.js';
import authMiddleware from '../../middleware/auth.js';
import editableMiddleware from '../../middleware/verifyEditable.js';

const router = express.Router();
const MAX_MODEL_LENGTH = 256;

function hasControlCharacter(value) {
  return [...value].some((character) => {
    const code = character.charCodeAt(0);
    return code < 32 || code === 127;
  });
}

function normalizeModel(value) {
  if (value === null || value === undefined || (typeof value === 'string' && value.trim() === '')) return null;
  if (typeof value !== 'string') throw new Error('organization_model_invalid');
  const model = value.trim();
  if (!model || model.length > MAX_MODEL_LENGTH || hasControlCharacter(model))
    throw new Error('organization_model_invalid');
  return model;
}

function safeOrganization(organization) {
  if (!organization) return null;
  return {
    id: organization.id,
    name: organization.name,
    herculesModel: typeof organization.herculesModel === 'string' ? organization.herculesModel : null,
  };
}

async function organizationFor(project, Organization) {
  const projectOwnerUserId = Number(project.userId);
  if (!Number.isInteger(projectOwnerUserId) || projectOwnerUserId <= 0) throw new Error('organization_owner_invalid');

  const organizationId = Number(project.organizationId);
  if (Number.isInteger(organizationId) && organizationId > 0) {
    const existing = await Organization.findByPk(organizationId);
    if (existing) {
      const organizationOwnerUserId = Number(existing.ownerUserId);
      if (!Number.isInteger(organizationOwnerUserId) || organizationOwnerUserId !== projectOwnerUserId)
        throw new Error('organization_scope_invalid');
      return existing;
    }
  }

  const [organization] = await Organization.findOrCreate({
    where: { ownerUserId: projectOwnerUserId },
    defaults: { name: `Organization ${projectOwnerUserId}`, ownerUserId: projectOwnerUserId },
  });
  await project.update({ organizationId: organization.id });
  return organization;
}

function invalidModelResponse() {
  return {
    error: 'organization_model_invalid',
    fields: [{ field: 'model', code: 'invalid', message: 'Enter a model name of 256 characters or fewer.' }],
  };
}

export default function (sequelize) {
  const { verifySignedIn } = authMiddleware(sequelize);
  const { verifyProjectManagerFromProjectId } = editableMiddleware(sequelize);
  const Project = defineProject(sequelize, DataTypes);
  const Organization = defineOrganization(sequelize, DataTypes);

  router.get(
    '/:projectId/settings/hercules-model',
    verifySignedIn,
    verifyProjectManagerFromProjectId,
    async (req, res) => {
      try {
        const project = await Project.findByPk(req.params.projectId);
        if (!project) return res.status(404).json({ error: 'project_not_found' });
        const organization = await organizationFor(project, Organization);
        return res.json({ organization: safeOrganization(organization.get({ plain: true })) });
      } catch {
        return res.status(500).json({ error: 'organization_model_unavailable' });
      }
    }
  );

  router.put(
    '/:projectId/settings/hercules-model',
    verifySignedIn,
    verifyProjectManagerFromProjectId,
    async (req, res) => {
      let model;
      try {
        model = normalizeModel(req.body?.model);
      } catch {
        return res.status(400).json(invalidModelResponse());
      }

      try {
        const project = await Project.findByPk(req.params.projectId);
        if (!project) return res.status(404).json({ error: 'project_not_found' });
        const organization = await organizationFor(project, Organization);
        const ownerUserId = Number(organization.ownerUserId);
        if (!Number.isInteger(ownerUserId) || ownerUserId !== Number(req.userId))
          return res.status(403).json({ error: 'organization_owner_required' });
        await organization.update({ herculesModel: model });
        return res.json({ organization: safeOrganization(organization.get({ plain: true })) });
      } catch {
        return res.status(500).json({ error: 'organization_model_unavailable' });
      }
    }
  );

  return router;
}
