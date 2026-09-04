import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const root = resolve(dirname(fileURLToPath(import.meta.url)));
const compose = readFileSync(resolve(root, 'docker-compose.yaml'), 'utf8').replaceAll('\r\n', '\n');
const productionCompose = readFileSync(resolve(root, 'docker-compose.production.yaml'), 'utf8').replaceAll(
  '\r\n',
  '\n'
);
const dockerfile = readFileSync(resolve(root, 'Dockerfile'), 'utf8');
const entrypoint = readFileSync(resolve(root, 'entrypoint.js'), 'utf8');
const envExample = readFileSync(resolve(root, '.env.example'), 'utf8');
const releaseWorkflow = readFileSync(resolve(root, '.github/workflows/release.yml'), 'utf8').replaceAll('\r\n', '\n');

function serviceBlock(source: string, name: string, nextService: string): string {
  const start = source.indexOf(`  ${name}:\n`);
  const nextMarker = nextService === 'volumes' ? `\n${nextService}:` : `\n  ${nextService}:`;
  const end = source.indexOf(nextMarker, start);
  expect(start).toBeGreaterThanOrEqual(0);
  expect(end).toBeGreaterThan(start);
  return source.slice(start, end);
}

describe('containerized automation boundaries', () => {
  it('keeps the API fail-closed by default while allowing an explicit mode override', () => {
    const api = serviceBlock(compose, 'unittcms', 'redis');

    expect(api).toContain('target: default');
    expect(api).toContain('AUTOMATION_EXECUTION_MODE=${AUTOMATION_EXECUTION_MODE:-disabled}');
    expect(api).toContain('AUTOMATION_PHASE0_READY=false');
    expect(api).not.toMatch(/HERCULES_LLM_|LITELLM_|OLLAMA_API_KEY|AUTOMATION_WORKER_SECRET/);
    expect(api).not.toContain('/var/run/docker.sock');
  });

  it('keeps the real worker opt-in and secret-free in Compose argv', () => {
    const worker = serviceBlock(compose, 'automation-worker', 'volumes');

    expect(worker).toContain("profiles: ['automation-worker']");
    expect(worker).toContain('target: automation-worker');
    expect(worker).toContain('AUTOMATION_EXECUTION_MODE=real');
    expect(worker).toContain('AUTOMATION_PHASE0_READY=${AUTOMATION_PHASE0_READY:-false}');
    expect(worker).toContain('AUTOMATION_WORKER_MODULE=./backend/automation/worker-bootstrap.js');
    expect(worker).toContain('AUTOMATION_HERCULES_VOLUME=${AUTOMATION_HERCULES_VOLUME:-unittcms_hercules-work}');
    expect(worker).toContain('hercules-work:/app/backend/private/hercules-work');
    expect(worker).toContain('LITELLM_API_KEY_FILE=/run/secrets/litellm_api_key');
    expect(worker).toContain('OLLAMA_API_KEY_FILE=/run/secrets/ollama_api_key');
    expect(worker).toContain('AUTOMATION_WORKER_SECRET_FILE=/run/secrets/automation_worker_secret');
    expect(worker).toContain('source: ${AUTOMATION_SECRETS_DIR_HOST:-./.secrets}');
    expect(worker).toContain('target: /run/secrets');
    expect(worker).toContain('source: /var/run/docker.sock');
    expect(worker).toContain('read_only: true');
    expect(worker).not.toMatch(/LITELLM_API_KEY\s*=/);
    expect(worker).not.toMatch(/OLLAMA_API_KEY\s*=/);
    expect(worker).not.toMatch(/AUTOMATION_WORKER_SECRET\s*=/);
    expect(compose).toContain('name: ${AUTOMATION_HERCULES_VOLUME:-unittcms_hercules-work}');
  });

  it('builds the worker-only Docker CLI capability and passes safe worker config', () => {
    expect(dockerfile).toContain('FROM runner AS automation-worker');
    expect(dockerfile).toContain('apk add --no-cache docker-cli');
    expect(dockerfile).toContain('test -f /app/backend/automation/worker-bootstrap.js');
    expect(dockerfile).toContain('ENV AUTOMATION_WORKER_MODULE=./backend/automation/worker-bootstrap.js');
    expect(entrypoint).toContain('automation_phase0_not_ready');
    expect(entrypoint).toContain('AUTOMATION_WORKER_SECRET_FILE');
    expect(entrypoint).toContain('workerSecret: readWorkerSecret()');
    expect(entrypoint).toContain("phase0Ready: process.env.AUTOMATION_PHASE0_READY === 'true'");
    expect(envExample).toContain('AUTOMATION_EXECUTION_MODE=disabled');
    expect(envExample).toContain('AUTOMATION_WORKER_MODULE=./backend/automation/worker-bootstrap.js');
    expect(envExample).toContain('HERCULES_LLM_PROVIDER=ollama');
    expect(envExample).toContain('HERCULES_LLM_PROVIDER=ollama-cloud');
    expect(envExample).toContain('HERCULES_LLM_MODEL=replace-with-exact-installed-ollama-tag');
    expect(envExample).toContain('LITELLM_BASE_URL=http://host.docker.internal:11434');
    expect(envExample).toContain('LITELLM_API_KEY_FILE=/run/secrets/litellm_api_key');
    expect(envExample).toContain('OLLAMA_API_KEY_FILE=/run/secrets/ollama_api_key');
    expect(envExample).toContain('OLLAMA_API_KEY=');
    expect(envExample).toContain('LITELLM_BASE_URL=https://ollama.com/api');
    expect(envExample).toContain('AUTOMATION_SECRETS_DIR_HOST=./.secrets');
    expect(envExample).toContain('AUTOMATION_HERCULES_VOLUME=unittcms_hercules-work');
    expect(envExample).toContain('# UNITTCMS_UPLOADS_VOLUME=unittcms_uploads');
    expect(entrypoint).toContain('workVolume: process.env.AUTOMATION_HERCULES_VOLUME');
  });
});

describe('registry-backed production deployment', () => {
  it('uses prebuilt GHCR images and named persistence without source-build or upload binds', () => {
    const api = serviceBlock(productionCompose, 'unittcms', 'redis');
    const worker = serviceBlock(productionCompose, 'automation-worker', 'volumes');

    expect(api).toContain('image: ${UNITTCMS_IMAGE:-ghcr.io/danielrondongarcia/unittcms:latest}');
    expect(worker).toContain(
      'image: ${UNITTCMS_WORKER_IMAGE:-ghcr.io/danielrondongarcia/unittcms-automation-worker:latest}'
    );
    expect(productionCompose).not.toContain('build:');
    expect(productionCompose).not.toContain('./backend/public/uploads');
    expect(productionCompose).toContain('uploads-data:/app/backend/public/uploads');
    expect(productionCompose).toContain('name: ${UNITTCMS_UPLOADS_VOLUME:-unittcms_uploads}');
    expect(productionCompose).toContain('db-data:/app/backend/database');
    expect(productionCompose).toContain('manual-execution-evidence:/app/backend/private/manual-execution-evidence');
    expect(productionCompose).toContain('automation-artifacts:/app/backend/private/automation-artifacts');
  });

  it('keeps the production worker opt-in and preserves worker-only boundaries', () => {
    const api = serviceBlock(productionCompose, 'unittcms', 'redis');
    const worker = serviceBlock(productionCompose, 'automation-worker', 'volumes');

    expect(worker).toContain("profiles: ['automation-worker']");
    expect(worker).toContain(
      'AUTOMATION_HERCULES_IMAGE=${AUTOMATION_HERCULES_IMAGE:-ghcr.io/danielrondongarcia/testzeus-hercules:latest}'
    );
    expect(worker).toContain('hercules-work:/app/backend/private/hercules-work');
    expect(productionCompose).toContain('name: ${AUTOMATION_HERCULES_VOLUME:-unittcms_hercules-work}');
    expect(worker).toContain('source: ${AUTOMATION_SECRETS_DIR_HOST:-./.secrets}');
    expect(worker).toContain('target: /run/secrets');
    expect(worker).toContain('source: /var/run/docker.sock');
    expect(worker).toContain('read_only: true');
    expect(worker).toContain('LITELLM_API_KEY_FILE=/run/secrets/litellm_api_key');
    expect(worker).toContain('OLLAMA_API_KEY_FILE=/run/secrets/ollama_api_key');
    expect(worker).toContain('AUTOMATION_WORKER_SECRET_FILE=/run/secrets/automation_worker_secret');
    expect(api).not.toMatch(/HERCULES_LLM_|LITELLM_|OLLAMA_API_KEY|AUTOMATION_WORKER_SECRET/);
    expect(api).not.toContain('/var/run/docker.sock');
    expect(worker).not.toMatch(/LITELLM_API_KEY\s*=/);
    expect(worker).not.toMatch(/OLLAMA_API_KEY\s*=/);
    expect(worker).not.toMatch(/AUTOMATION_WORKER_SECRET\s*=/);
  });
});

describe('release image workflow', () => {
  it('publishes both Dockerfile targets with the repository token and release tags', () => {
    expect(releaseWorkflow).toContain("- '*.*.*'");
    expect(releaseWorkflow).toContain('workflow_dispatch:');
    expect(releaseWorkflow).toContain('release_tag:');
    expect(releaseWorkflow).toContain('git show-ref --tags --verify --quiet');
    expect(releaseWorkflow).toContain('revision=$(git rev-parse HEAD)');
    expect(releaseWorkflow).toContain('contents: write');
    expect(releaseWorkflow).toContain('packages: write');
    expect(releaseWorkflow).toContain('password: ${{ secrets.GITHUB_TOKEN }}');
    expect(releaseWorkflow).toContain('ghcr.io/danielrondongarcia/unittcms');
    expect(releaseWorkflow).toContain('ghcr.io/danielrondongarcia/unittcms-automation-worker');
    expect(releaseWorkflow).toContain('target: default');
    expect(releaseWorkflow).toContain('target: automation-worker');
    expect(releaseWorkflow).toContain('id: meta_api');
    expect(releaseWorkflow).toContain('id: meta_worker');
    expect(releaseWorkflow).toContain('push: true');
    expect(releaseWorkflow).toContain('latest=false');
    expect(releaseWorkflow).toContain('type=raw,value=${{ steps.release.outputs.version }}');
    expect(releaseWorkflow).toContain('type=raw,value=latest,enable=${{ steps.release.outputs.stable }}');
    expect(releaseWorkflow).toContain('gh release create');
    expect(releaseWorkflow.toLowerCase()).not.toContain('pypi');
  });
});
