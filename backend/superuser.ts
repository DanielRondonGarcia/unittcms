import bcrypt from 'bcrypt';
import { DataTypes, type Sequelize } from 'sequelize';
import defineUser from './models/users.js';
import { roles } from './routes/users/authSettings.js';

type SuperuserEnvironment = Readonly<Record<string, string | undefined>>;

const administratorRole = roles.findIndex((entry) => entry.uid === 'administrator');

/** Ensure the optional environment-configured administrator exists without changing existing passwords. */
export async function ensureSuperuser(
  sequelize: Sequelize,
  environment: SuperuserEnvironment = process.env
): Promise<void> {
  const email = environment.SUPERUSER_EMAIL?.trim();
  if (!email) return;

  const User = defineUser(sequelize, DataTypes);
  const existingUser = await User.findOne({ where: { email } });

  if (!existingUser) {
    const password = environment.SUPERUSER_PASSWORD;
    if (!password) {
      throw new Error('SUPERUSER_PASSWORD is required when the configured superuser does not exist.');
    }

    const username = environment.SUPERUSER_USERNAME?.trim() || email.split('@')[0] || email;
    const hashedPassword = await bcrypt.hash(password, 10);
    await User.create({
      email,
      password: hashedPassword,
      username,
      role: administratorRole,
    });
    return;
  }

  if (existingUser.role !== administratorRole) {
    await existingUser.update({ role: administratorRole });
  }
}
