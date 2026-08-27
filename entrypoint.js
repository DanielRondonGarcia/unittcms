import { createServer as createHttpServer } from 'http';
import path from 'path';
import fs from 'fs';
import { execSync } from 'child_process';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Use express from backend node_modules
import expressModule from './backend/node_modules/express/index.js';
import { API_PATH, IS_PROD } from './backend/config/config.js';
const express = expressModule.default || expressModule;

function prepareAutomationRuntime() {
  const mode = process.env.AUTOMATION_EXECUTION_MODE || 'disabled';
  if (!['disabled', 'fake', 'real'].includes(mode)) {
    throw new Error('AUTOMATION_EXECUTION_MODE must be disabled, fake, or real');
  }
  if (IS_PROD && mode === 'fake') {
    throw new Error('AUTOMATION_EXECUTION_MODE=fake is not allowed in production');
  }

  const artifactRoot =
    process.env.AUTOMATION_ARTIFACT_ROOT || path.join(__dirname, 'backend/private/automation-artifacts');
  fs.mkdirSync(artifactRoot, { recursive: true });
  console.log(`Automation execution mode: ${mode}`);
  if (mode === 'real' && process.env.AUTOMATION_PHASE0_READY !== 'true') {
    console.warn('Automation remains not ready: Phase-0 compatibility proof is absent');
  }
}

function readWorkerSecret() {
  const secretFile = process.env.AUTOMATION_WORKER_SECRET_FILE?.trim();
  if (secretFile) {
    try {
      const secret = fs.readFileSync(secretFile, 'utf8').trim();
      if (!secret) throw new Error('automation_worker_secret_required');
      return secret;
    } catch (error) {
      if (error instanceof Error && error.message === 'automation_worker_secret_required') throw error;
      throw new Error('automation_worker_secret_file_unreadable');
    }
  }

  const secret = process.env.AUTOMATION_WORKER_SECRET?.trim();
  if (!secret) throw new Error('automation_worker_secret_required');
  return secret;
}

function workerAllowedHosts() {
  const value = process.env.HERCULES_ALLOWED_HOSTS?.trim();
  if (!value) return undefined;
  return value
    .split(',')
    .map((host) => host.trim())
    .filter(Boolean);
}

async function runMigrations() {
  try {
    console.log('Running database migrations...');
    // Use execSync with cwd option to run in the backend directory
    execSync('npx sequelize-cli db:migrate', {
      cwd: path.join(__dirname, 'backend'),
      stdio: 'inherit',
    });
    console.log('Database migrations completed successfully.');
    if (process.env.IS_DEMO === 'true' || process.env.IS_DEMO === '1') {
      console.log('Demo mode detected. Seeding the database...');
      execSync('npx sequelize-cli db:seed:all', {
        cwd: path.join(__dirname, 'backend'),
        stdio: 'inherit',
      });
      console.log('Database seeding completed successfully.');
    }
  } catch (error) {
    console.error('Error running database migrations or seeding:', error);
    throw error;
  }
}

async function startServer() {
  try {
    const server = express();
    const httpServer = createHttpServer(server);

    // Import the backend app
    const backendAppModule = await import('./backend/server.js');
    const backendApp = backendAppModule.default || backendAppModule;

    console.log(`Mounting backend API at: ${API_PATH}`);
    server.use(API_PATH, backendApp);

    // For Next.js standalone build
    // Check if we have the Next.js server file
    const nextServerPath = './node_modules/next/dist/server/next.js';
    if (fs.existsSync(nextServerPath)) {
      // Import Next.js
      const nextModule = await import(nextServerPath);
      const next = nextModule.default || nextModule;

      // Initialize Next.js app
      const dev = !IS_PROD;
      const nextApp = next({ dev, dir: path.join(__dirname, '.') });
      const handle = nextApp.getRequestHandler();
      await nextApp.prepare();
      console.log('nextjs prepared');

      // Use Next.js to handle all other routes
      server.all('*', (req, res) => handle(req, res));
    } else {
      console.error('Next.js module not found at:', nextServerPath);
      server.all('*', (req, res) => {
        res.status(500).send('Frontend server not available');
      });
    }

    const PORT = process.env.PORT || 8000;
    httpServer.listen(PORT, (err) => {
      if (err) throw err;
      console.log(`> Ready on http://localhost:${PORT}`);
    });
  } catch (error) {
    console.error('Error starting server:', error);
    process.exit(1);
  }
}

async function startWorker() {
  prepareAutomationRuntime();
  if (process.env.AUTOMATION_EXECUTION_MODE !== 'real') {
    throw new Error('The worker profile requires AUTOMATION_EXECUTION_MODE=real');
  }
  if (process.env.AUTOMATION_PHASE0_READY !== 'true') {
    throw new Error('automation_phase0_not_ready');
  }
  const workerModuleName = process.env.AUTOMATION_WORKER_MODULE;
  if (!workerModuleName) {
    throw new Error('The worker profile requires an injected AUTOMATION_WORKER_MODULE');
  }
  const workerModule = await import(workerModuleName);
  if (typeof workerModule.start !== 'function') {
    throw new Error('AUTOMATION_WORKER_MODULE must export start(runtimeConfig)');
  }
  await workerModule.start({
    redisUrl: process.env.AUTOMATION_REDIS_URL,
    artifactRoot: process.env.AUTOMATION_ARTIFACT_ROOT,
    workdir: process.env.AUTOMATION_HERCULES_WORKDIR,
    image: process.env.AUTOMATION_HERCULES_IMAGE,
    workVolume: process.env.AUTOMATION_HERCULES_VOLUME,
    allowedHosts: workerAllowedHosts(),
    phase0Ready: process.env.AUTOMATION_PHASE0_READY === 'true',
    workerSecret: readWorkerSecret(),
  });
}

if (process.env.SERVICE_ROLE === 'worker') {
  startWorker().catch((error) => {
    console.error('Failed to start automation worker:', error);
    process.exit(1);
  });
} else {
  prepareAutomationRuntime();
  runMigrations()
    .then(() => {
      startServer();
    })
    .catch((error) => {
      console.error('Failed to start application:', error);
      process.exit(1);
    });
}
