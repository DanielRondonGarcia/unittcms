import express from 'express';
const router = express.Router();
import { DataTypes } from 'sequelize';
import defineProject from '../../models/projects.js';
import defineOrganization from '../../models/organizations.js';
import authMiddleware from '../../middleware/auth.js';

export default function (sequelize) {
  const { verifySignedIn } = authMiddleware(sequelize);
  const Project = defineProject(sequelize, DataTypes);
  const Organization = defineOrganization(sequelize, DataTypes);

  router.post('/', verifySignedIn, async (req, res) => {
    try {
      const { name, detail, isPublic } = req.body;
      const [organization] = await Organization.findOrCreate({
        where: { ownerUserId: req.userId },
        defaults: { name: `Organization ${req.userId}`, ownerUserId: req.userId },
      });
      const newProject = await Project.create({
        name,
        detail,
        isPublic,
        userId: req.userId,
        organizationId: organization.id,
      });
      res.json(newProject);
    } catch (error) {
      console.error(error);
      res.status(500).send('Internal Server Error');
    }
  });

  return router;
}
