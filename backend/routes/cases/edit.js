import express from 'express';
const router = express.Router();
import { DataTypes } from 'sequelize';
import defineCase from '../../models/cases.js';
import authMiddleware from '../../middleware/auth.js';
import editableMiddleware from '../../middleware/verifyEditable.js';
import { gherkinTemplate, hasValidGherkinKeywords } from '../../config/enums.js';

export default function (sequelize) {
  const { verifySignedIn } = authMiddleware(sequelize);
  const { verifyProjectDeveloperFromCaseId } = editableMiddleware(sequelize);
  const Case = defineCase(sequelize, DataTypes);

  router.put('/:caseId', verifySignedIn, verifyProjectDeveloperFromCaseId, async (req, res) => {
    const caseId = req.params.caseId;
    const updateCase = req.body;
    try {
      const testcase = await Case.findByPk(caseId);
      if (!testcase) {
        return res.status(404).send('Case not found');
      }

      const isGherkin = (updateCase.template ?? testcase.template) === gherkinTemplate;
      if (isGherkin && updateCase.Steps !== undefined && !hasValidGherkinKeywords(updateCase.Steps)) {
        return res.status(400).json({ error: 'Gherkin steps require given, when, or then keywords' });
      }

      const values = { ...updateCase };
      if (updateCase.Steps !== undefined) {
        delete values.Steps;
      }
      if (isGherkin) values.automationVersion = Number(testcase.automationVersion || 1) + 1;

      await testcase.update(values);
      res.json(testcase);
    } catch (error) {
      console.error(error);
      res.status(500).send('Internal Server Error');
    }
  });

  return router;
}
