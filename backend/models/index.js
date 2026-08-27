import fs from 'fs';
import path from 'path';
import { fileURLToPath, pathToFileURL } from 'url';
import process from 'process';
import Sequelize from 'sequelize';
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const basename = path.basename(__filename);
import configDefault from '../config/config.js';
const config = {
  ...configDefault[process.env.NODE_ENV || 'development'],
  storage: process.env.DATABASE_PATH ?? path.resolve(__dirname, '../database/database.sqlite'),
  logging: false,
};
const db = {};

let sequelize;
if (config.use_env_variable) {
  sequelize = new Sequelize(process.env[config.use_env_variable], config);
} else {
  sequelize = new Sequelize(config);
}

const modelFiles = fs.readdirSync(__dirname).filter((file) => {
  return file.indexOf('.') !== 0 && file !== basename && file.slice(-3) === '.js' && file.indexOf('.test.js') === -1;
});

for (const file of modelFiles) {
  const module = await import(pathToFileURL(path.join(__dirname, file)).href);
  const model = module.default(sequelize, Sequelize.DataTypes);
  db[model.name] = model;
}

Object.keys(db).forEach((modelName) => {
  if (db[modelName].associate) {
    db[modelName].associate(db);
  }
});

db.sequelize = sequelize;
db.Sequelize = Sequelize;

export default db;
