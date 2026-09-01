function defineCase(sequelize, DataTypes) {
  const parseGherkinExamples = (value) => {
    if (value === null || value === undefined || value === '') return null;
    if (typeof value === 'object' && !Array.isArray(value)) return value;
    if (typeof value !== 'string') return null;
    try {
      const parsed = JSON.parse(value);
      return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : null;
    } catch {
      return null;
    }
  };

  const serializeGherkinExamples = (value) => {
    if (value === null || value === undefined || value === '') return null;
    if (typeof value === 'string') return value;
    return JSON.stringify(value);
  };

  const Case = sequelize.define('Case', {
    title: {
      type: DataTypes.STRING,
      allowNull: false,
    },
    state: {
      type: DataTypes.INTEGER,
      allowNull: false,
    },
    priority: {
      type: DataTypes.INTEGER,
      allowNull: false,
    },
    type: {
      type: DataTypes.INTEGER,
      allowNull: false,
    },
    automationStatus: {
      type: DataTypes.INTEGER,
      allowNull: false,
    },
    description: {
      type: DataTypes.STRING,
      allowNull: true,
    },
    template: {
      type: DataTypes.INTEGER,
      allowNull: false,
    },
    automationVersion: { type: DataTypes.INTEGER, allowNull: false, defaultValue: 1 },
    gherkinExamples: {
      type: DataTypes.TEXT,
      allowNull: true,
      get() {
        return parseGherkinExamples(this.getDataValue('gherkinExamples'));
      },
      set(value) {
        this.setDataValue('gherkinExamples', serializeGherkinExamples(value));
      },
    },
    preConditions: {
      type: DataTypes.STRING,
      allowNull: true,
    },
    expectedResults: {
      type: DataTypes.STRING,
      allowNull: true,
    },
    folderId: {
      type: DataTypes.INTEGER,
      allowNull: false,
      references: {
        model: 'folder',
        key: 'id',
      },
      onDelete: 'CASCADE',
    },
  });

  Case.associate = (models) => {
    Case.belongsTo(models.Folder, {
      foreignKey: 'folderId',
      onDelete: 'CASCADE',
    });
    Case.belongsToMany(models.Step, {
      through: 'caseSteps',
    });
    Case.belongsToMany(models.Tags, {
      through: 'caseTags',
      foreignKey: 'caseId',
      otherKey: 'tagId',
    });
    Case.hasMany(models.AutomationDefinition, { foreignKey: 'caseId', onDelete: 'CASCADE' });
    Case.hasMany(models.AutomationExecution, { foreignKey: 'caseId', onDelete: 'CASCADE' });
    Case.hasMany(models.ManualExecution, { foreignKey: 'caseId', onDelete: 'SET NULL' });
  };

  return Case;
}

export default defineCase;
