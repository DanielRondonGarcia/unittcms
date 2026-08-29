function defineExecutionEvent(sequelize, DataTypes) {
  const ExecutionEvent = sequelize.define('ExecutionEvent', {
    executionId: {
      type: DataTypes.INTEGER,
      allowNull: false,
      references: {
        model: 'automationExecutions',
        key: 'id',
      },
      onDelete: 'CASCADE',
    },
    attempt: {
      type: DataTypes.INTEGER,
      allowNull: false,
    },
    sequence: {
      type: DataTypes.INTEGER,
      allowNull: false,
    },
    eventType: {
      type: DataTypes.STRING,
      allowNull: false,
    },
    message: {
      type: DataTypes.STRING,
      allowNull: true,
    },
    details: {
      type: DataTypes.TEXT,
      allowNull: true,
    },
  });

  ExecutionEvent.associate = (models) => {
    ExecutionEvent.belongsTo(models.AutomationExecution, { foreignKey: 'executionId', onDelete: 'CASCADE' });
  };

  return ExecutionEvent;
}

export default defineExecutionEvent;
