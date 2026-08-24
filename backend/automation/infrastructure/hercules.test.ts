import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { CANONICAL_FEATURE, HERCULES_CONTRACT } from '../compatibility/hercules.js';
import { NeutralExecutorRegistry } from '../ports/registry.js';
import type { HerculesProcessResult, HerculesProcessRunner } from './hercules.js';
import { HerculesAutomationExecutor } from './hercules.js';

const roots: string[] = [];
afterEach(() => roots.splice(0).forEach((root) => rmSync(root, { recursive: true, force: true })));
function root(): string {
  const value = mkdtempSync(join(tmpdir(), 'unittcms-hercules-adapter-'));
  roots.push(value);
  return value;
}
function junit(cwd: string, failures = 0, errors = 0): void {
  mkdirSync(join(cwd, 'output'), { recursive: true });
  writeFileSync(
    join(cwd, 'output', 'scenario.xml'),
    `<testsuite tests="1" failures="${failures}" errors="${errors}"></testsuite>`
  );
}

describe('Hercules automation executor', () => {
  it('passes the canonical feature through the pinned, bounded, secret-safe boundary', async () => {
    const workdir = root();
    let observed!: {
      invocation: { file: string; cwd: string; argv: string[] };
      env: Record<string, string>;
      timeoutMs: number;
    };
    const apiKey = ['fixture', 'value'].join('-');
    const processRunner = vi.fn(async (invocation, options) => {
      observed = { invocation, env: options.env, timeoutMs: options.timeoutMs };
      expect(readFileSync(join(invocation.cwd, 'input', 'test.feature'), 'utf8')).toBe(CANONICAL_FEATURE);
      options.registerCancellation(vi.fn());
      junit(invocation.cwd);
      return { exitCode: 0 };
    });
    const executor = new HerculesAutomationExecutor({
      workdir,
      timeoutMs: HERCULES_CONTRACT.timeoutMs + 1,
      liteLLM: { baseUrl: 'https://llm.test/v1', apiKey },
      processRunner,
    });

    await expect(
      executor.execute({ executionId: 'safe; touch forbidden', snapshot: CANONICAL_FEATURE })
    ).resolves.toMatchObject({ outcome: 'passed' });
    expect(observed.invocation.file).toBe('docker');
    expect(observed.invocation.cwd).not.toContain('safe; touch forbidden');
    expect(observed.invocation.argv).toEqual([
      ...HERCULES_CONTRACT.argv,
      '--mount',
      `type=bind,src=${observed.invocation.cwd},dst=/testzeus-hercules/opt`,
      HERCULES_CONTRACT.image,
    ]);
    expect(observed.invocation.argv.join(' ')).not.toContain(apiKey);
    expect(observed.env).toMatchObject({
      HEADLESS: 'true',
      BROWSER_TYPE: 'chromium',
      LITELLM_BASE_URL: 'https://llm.test/v1',
      LITELLM_API_KEY: apiKey,
    });
    expect(observed.timeoutMs).toBe(HERCULES_CONTRACT.timeoutMs);
    expect(observed.invocation.argv).toEqual(expect.arrayContaining(['--cpus=2', '--memory=4g', '--pids-limit=256']));
  });

  it.each([
    [{ exitCode: 0 }, 0, 0, 'passed'],
    [{ exitCode: 1 }, 1, 0, 'functional_failure'],
    [{ exitCode: 1 }, 0, 1, 'technical_error'],
    [{ exitCode: 2 }, 0, 0, 'technical_error'],
  ])('maps exit and JUnit results to %s', async (processResult, failures, errors, outcome) => {
    const processRunner = vi.fn(async (invocation, options) => {
      options.registerCancellation(vi.fn());
      junit(invocation.cwd, failures, errors);
      return processResult;
    });
    const executor = new HerculesAutomationExecutor({ workdir: root(), processRunner });

    await expect(
      executor.execute({ executionId: `run-${outcome}`, snapshot: CANONICAL_FEATURE })
    ).resolves.toMatchObject({ outcome });
  });

  it('maps process faults and timeout without returning process messages', async () => {
    const technical = new HerculesAutomationExecutor({
      workdir: root(),
      processRunner: vi.fn(async () => {
        throw Object.assign(new Error('fixture process detail'), { code: 'EIO' });
      }),
    });
    await expect(technical.execute({ executionId: 'technical', snapshot: CANONICAL_FEATURE })).resolves.toEqual({
      outcome: 'technical_error',
      error: 'hercules_process_failed',
    });

    const timeout = new HerculesAutomationExecutor({
      workdir: root(),
      processRunner: vi.fn(async () => {
        throw Object.assign(new Error('fixture timeout detail'), { code: 'ETIMEDOUT' });
      }),
    });
    await expect(timeout.execute({ executionId: 'timeout', snapshot: CANONICAL_FEATURE })).resolves.toEqual({
      outcome: 'timeout',
      error: 'hercules_timeout',
    });

    const secret = ['fixture', 'value'].join('-');
    const redacted = new HerculesAutomationExecutor({
      workdir: root(),
      processRunner: vi.fn(async (invocation, options) => {
        options.registerCancellation(vi.fn());
        junit(invocation.cwd);
        writeFileSync(join(invocation.cwd, 'output', 'scenario.xml'), `password=${secret}`);
        return { exitCode: 0 };
      }),
    });
    await expect(redacted.execute({ executionId: 'redacted', snapshot: CANONICAL_FEATURE })).resolves.toEqual({
      outcome: 'technical_error',
      error: 'evidence_secret_detected',
    });
  });

  it('terminates active work on cancellation and is idempotent for unknown executions', async () => {
    const terminated = vi.fn();
    const processRunner: HerculesProcessRunner = vi.fn(
      (_invocation, options) =>
        new Promise<HerculesProcessResult>((resolve) => {
          options.registerCancellation(() => {
            terminated();
            resolve({ exitCode: null, signal: 'SIGKILL' });
          });
        })
    );
    const executor = new HerculesAutomationExecutor({ workdir: root(), processRunner });
    const running = executor.execute({ executionId: 'cancel-me', snapshot: CANONICAL_FEATURE });
    await vi.waitFor(() => expect(processRunner).toHaveBeenCalled());

    await executor.cancel('cancel-me');
    await expect(running).resolves.toEqual({ outcome: 'cancelled', error: 'hercules_cancelled' });
    await executor.cancel('cancel-me');
    await executor.cancel('unknown');
    expect(terminated).toHaveBeenCalledOnce();
  });

  it('fails readiness closed until the compatibility proof is available and stays registry-neutral', async () => {
    const gate = vi.fn(async () => ({ ready: false }));
    const executor = new HerculesAutomationExecutor({ workdir: root(), compatibilityGate: gate });
    await expect(executor.health()).resolves.toEqual({
      key: 'hercules',
      ready: false,
      status: 'compatibility_not_ready',
    });
    gate.mockResolvedValue({ ready: true });
    await expect(executor.health()).resolves.toEqual({ key: 'hercules', ready: true, status: 'ready' });
    expect(gate).toHaveBeenCalledWith(
      expect.objectContaining({
        feature: CANONICAL_FEATURE,
        workdir: expect.any(String),
        evidenceRoot: expect.any(String),
      })
    );

    const registry = new NeutralExecutorRegistry();
    registry.register('hercules', executor);
    await expect(registry.select('hercules')).resolves.toBe(executor);
  });
});
