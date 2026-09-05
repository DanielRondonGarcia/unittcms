import process from 'node:process';
import server, { sequelize } from './server.js';
import { PORT } from './config/config.js';
import { ensureSuperuser } from './superuser.js';

async function startServer(): Promise<void> {
  try {
    await ensureSuperuser(sequelize);
    server.listen(PORT, () => {
      console.log(`Backend server is running on port ${PORT}`);
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown startup error';
    console.error(`Failed to bootstrap configured superuser: ${message}`);
    process.exit(1);
  }
}

void startServer();
