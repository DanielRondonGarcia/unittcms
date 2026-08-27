import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const root = resolve(dirname(fileURLToPath(import.meta.url)));
const compose = readFileSync(resolve(root, 'docker-compose.yaml'), 'utf8').replaceAll('\r\n', '\n');
const dockerfile = readFileSync(resolve(root, 'Dockerfile'), 'utf8');
const entrypoint = readFileSync(resolve(root, 'entrypoint.js'), 'utf8');
const envExample = readFileSync(resolve(root, '.env.example'), 'utf8');

function serviceBlock(name: string, nextService: string): string {
  const start = compose.indexOf(`  ${name}:\n`);
  const nextMarker = nextService === 'volumes' ? `\n${nextService}:` : `\n  ${nextService}:`;
  const end = compose.indexOf(nextMarker, start);
  expect(start).toBeGreaterThanOrEqual(0);
  expect(end).toBeGreaterThan(start);
  return compose.slice(start, end);
}

describe('containerized automation boundaries', () => {
  it('keeps the API fail-closed by default while allowing an explicit mode override', () => {
    const api = serviceBlock('unittcms', 'redis');

    expect(api).toContain('target: default');
    expect(api).toContain('AUTOMATION_EXECUTION_MODE=${AUTOMATION_EXECUTION_MODE:-disabled}');
    expect(api).toContain('AUTOMATION_PHASE0_READY=false');
    expect(api).not.toMatch(/HERCULES_LLM_|LITELLM_|OLLAMA_API_KEY|AUTOMATION_WORKER_SECRET/);
    expect(api).not.toContain('/var/run/docker.sock');
  });

  it('keeps the real worker opt-in and secret-free in Compose argv', () => {
    const worker = serviceBlock('automation-worker', 'volumes');

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
    expect(entrypoint).toContain('workVolume: process.env.AUTOMATION_HERCULES_VOLUME');
  });
});
