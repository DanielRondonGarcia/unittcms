import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import * as compatibility from '../compatibility/hercules.js';
import { CANONICAL_FEATURE, HERCULES_CONTRACT } from '../compatibility/hercules.js';
import { NeutralExecutorRegistry } from '../ports/registry.js';
import { FileArtifactStorage } from './artifacts.js';
import type { HerculesProcessResult, HerculesProcessRunner } from './hercules.js';
import { HerculesAutomationExecutor } from './hercules.js';
import type { WorkerLlmConfig } from './llm-config.js';

const roots: string[] = [];
afterEach(() => {
  vi.restoreAllMocks();
  vi.useRealTimers();
  roots.splice(0).forEach((root) => rmSync(root, { recursive: true, force: true }));
});
function root(): string {
  const value = mkdtempSync(join(tmpdir(), 'unittcms-hercules-adapter-'));
  roots.push(value);
  return value;
}
function junit(cwd: string, failures = 0, errors = 0): void {
  mkdirSync(join(cwd, 'output'), { recursive: true });
  writeFileSync(
    join(cwd, 'output', 'scenario.xml'),
    `<testsuite tests="1" failures="${failures}" errors="${errors}"><testcase classname="fixture" name="scenario"/></testsuite>`
  );
}
function llmConfig(
  apiKey?: string,
  provider: WorkerLlmConfig['provider'] = 'openai-compatible',
  baseUrl = 'https://llm.test/v1'
): WorkerLlmConfig {
  const key = apiKey ?? (provider === 'ollama' ? '' : ['fixture', 'value'].join('-'));
  return {
    provider,
    model: 'fixture-model',
    baseUrl,
    apiKey: key,
    apiKeySource: key ? 'env' : 'none',
  };
}
const compatibilityEnvironment = { baseUrl: 'https://example.com', allowedHosts: ['example.com'], secretRefs: [] };

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
      expect(existsSync(join(invocation.cwd, 'test-data'))).toBe(true);
      options.registerCancellation(vi.fn());
      junit(invocation.cwd);
      return { exitCode: 0 };
    });
    const executor = new HerculesAutomationExecutor({
      workdir,
      timeoutMs: HERCULES_CONTRACT.timeoutMs + 1,
      llmConfig: llmConfig(apiKey),
      processRunner,
    });

    await expect(
      executor.execute({
        executionId: 'safe; touch forbidden',
        snapshot: CANONICAL_FEATURE,
        environment: compatibilityEnvironment,
      })
    ).resolves.toMatchObject({ outcome: 'passed' });
    expect(observed.invocation.file).toBe('docker');
    expect(observed.invocation.cwd).not.toContain('safe; touch forbidden');
    expect(observed.invocation.argv).toEqual([
      ...HERCULES_CONTRACT.argv,
      '--mount',
      `type=bind,src=${observed.invocation.cwd},dst=/testzeus-hercules/opt`,
      HERCULES_CONTRACT.image,
    ]);
    expect(observed.invocation.argv).toContain('RECORD_VIDEO=false');
    expect(observed.invocation.argv.join(' ')).not.toContain(apiKey);
    expect(observed.env).toMatchObject({
      HEADLESS: 'true',
      LLM_MODEL_NAME: 'fixture-model',
      LLM_MODEL_API_KEY: apiKey,
      LLM_MODEL_BASE_URL: 'https://llm.test/v1',
      LLM_MODEL_API_TYPE: 'openai',
      BROWSER_TYPE: 'chromium',
      HERCULES_BASE_URL: 'https://example.com/',
      HERCULES_ALLOWED_HOSTS: 'example.com',
      RECORD_VIDEO: 'false',
      PROJECT_SOURCE_ROOT: '/testzeus-hercules/opt',
      INPUT_GHERKIN_FILE_PATH: '/testzeus-hercules/opt/input/test.feature',
      JUNIT_XML_BASE_PATH: '/testzeus-hercules/opt/output',
      TEST_DATA_PATH: '/testzeus-hercules/opt/test-data',
    });
    expect(observed.env).not.toHaveProperty('HERCULES_LLM_PROVIDER');
    expect(observed.env).not.toHaveProperty('HERCULES_LLM_MODEL');
    expect(observed.env).not.toHaveProperty('LITELLM_BASE_URL');
    expect(observed.env).not.toHaveProperty('LITELLM_API_KEY');
    expect(observed.env).not.toHaveProperty('LLM_MODEL_CLIENT_HOST');
    expect(observed.timeoutMs).toBe(HERCULES_CONTRACT.timeoutMs);
    expect(observed.invocation.argv).toEqual(expect.arrayContaining(['--cpus=2', '--memory=4g', '--pids-limit=256']));
  });

  it('enables video capture only when the resolved environment opts in', async () => {
    let observedVideo = '';
    let observedVideoArgument = '';
    const processRunner = vi.fn(async (invocation, options) => {
      observedVideo = options.env.RECORD_VIDEO;
      observedVideoArgument = invocation.argv.find((value) => value.startsWith('RECORD_VIDEO=')) ?? '';
      options.registerCancellation(vi.fn());
      junit(invocation.cwd);
      return { exitCode: 0 };
    });
    const executor = new HerculesAutomationExecutor({ workdir: root(), llmConfig: llmConfig(), processRunner });

    await executor.execute({
      executionId: 'video-enabled',
      snapshot: CANONICAL_FEATURE,
      environment: { ...compatibilityEnvironment, captureVideo: true },
    });
    expect(observedVideo).toBe('true');
    expect(observedVideoArgument).toBe('RECORD_VIDEO=true');
  });

  it('returns validated video evidence before removing the execution workspace', async () => {
    let executionWorkspace = '';
    const processRunner = vi.fn(async (invocation, options) => {
      executionWorkspace = invocation.cwd;
      junit(invocation.cwd);
      mkdirSync(join(invocation.cwd, 'proofs', 'Scenario', 'run_1', 'videos'), { recursive: true });
      writeFileSync(join(invocation.cwd, 'proofs', 'Scenario', 'run_1', 'videos', 'step.webm'), Buffer.from('video'));
      options.registerCancellation(vi.fn());
      return { exitCode: 0 };
    });
    const executor = new HerculesAutomationExecutor({ workdir: root(), llmConfig: llmConfig(), processRunner });

    const result = await executor.execute({
      executionId: 'video-artifact',
      snapshot: CANONICAL_FEATURE,
      environment: { ...compatibilityEnvironment, captureVideo: true },
    });

    expect(result.outcome).toBe('passed');
    const video = result.artifacts?.find((artifact) => artifact.kind === 'video');
    expect(video).toMatchObject({
      filename: 'proofs/Scenario/run_1/videos/step.webm',
      mimeType: 'video/webm',
    });
    expect(video?.content).toEqual(Buffer.from('video'));
    expect(existsSync(executionWorkspace)).toBe(false);
  });

  it('sends evidence to the persistence sink before removing the execution workspace', async () => {
    let executionWorkspace = '';
    const persisted = vi.fn(async (artifacts) => {
      expect(executionWorkspace).not.toBe('');
      expect(existsSync(executionWorkspace)).toBe(true);
      expect(artifacts).toHaveLength(2);
      expect(artifacts.find((artifact) => artifact.kind === 'video')?.content).toEqual(Buffer.from('video'));
    });
    const processRunner = vi.fn(async (invocation, options) => {
      executionWorkspace = invocation.cwd;
      junit(invocation.cwd);
      mkdirSync(join(invocation.cwd, 'proofs', 'Scenario', 'run_1', 'videos'), { recursive: true });
      writeFileSync(join(invocation.cwd, 'proofs', 'Scenario', 'run_1', 'videos', 'step.webm'), Buffer.from('video'));
      options.registerCancellation(vi.fn());
      return { exitCode: 0 };
    });
    const executor = new HerculesAutomationExecutor({ workdir: root(), llmConfig: llmConfig(), processRunner });

    const result = await executor.execute({
      executionId: 'sink-artifact',
      snapshot: CANONICAL_FEATURE,
      environment: { ...compatibilityEnvironment, captureVideo: true },
      artifactSink: persisted,
    });

    expect(result).toEqual({ outcome: 'passed' });
    expect(persisted).toHaveBeenCalledOnce();
    expect(existsSync(executionWorkspace)).toBe(false);
  });

  it('allows a known large Hercules video through execution collection without weakening compatibility evidence', async () => {
    const largeVideo = Buffer.alloc(1024 * 1024 + 1, 0);
    let compatibilityGateReady = true;
    const storage = new FileArtifactStorage({ rootDir: root() });
    const persisted = vi.fn(async (artifacts) => {
      const video = artifacts.find((artifact) => artifact.kind === 'video');
      expect(video?.content.byteLength).toBe(largeVideo.byteLength);
      if (!video) throw new Error('video_artifact_missing');
      const ref = await storage.put({
        executionId: 'large-video',
        attempt: 1,
        content: video.content,
        mimeType: video.mimeType,
        filename: video.filename,
        kind: video.kind,
      });
      expect(ref.size).toBe(largeVideo.byteLength);
      await expect(storage.get(ref.storageKey, ref.sha256)).resolves.toEqual(largeVideo);
    });
    const processRunner = vi.fn(async (invocation, options) => {
      junit(invocation.cwd);
      mkdirSync(join(invocation.cwd, 'proofs', 'Scenario', 'run_1', 'videos'), { recursive: true });
      writeFileSync(join(invocation.cwd, 'proofs', 'Scenario', 'run_1', 'videos', 'large.webm'), largeVideo);
      compatibilityGateReady = compatibility.evaluateCompatibility({
        feature: CANONICAL_FEATURE,
        result: { exitCode: 0, result: 'passed' },
        evidence: compatibility.collectCompatibilityEvidence(invocation.cwd),
      }).ready;
      options.registerCancellation(vi.fn());
      return { exitCode: 0 };
    });
    const executor = new HerculesAutomationExecutor({ workdir: root(), llmConfig: llmConfig(), processRunner });

    await expect(
      executor.execute({
        executionId: 'large-video',
        snapshot: CANONICAL_FEATURE,
        environment: { ...compatibilityEnvironment, captureVideo: true },
        artifactSink: persisted,
      })
    ).resolves.toEqual({ outcome: 'passed' });
    expect(persisted).toHaveBeenCalledOnce();
    expect(compatibilityGateReady).toBe(false);
  });

  it('uses the explicit local image override and maps Ollama at the process boundary', async () => {
    const localImage = 'testzeus/hercules:0.1.2-amd64';
    let observedEnv!: Record<string, string>;
    let observedImage = '';
    const processRunner = vi.fn(async (invocation, options) => {
      observedImage = invocation.argv[invocation.argv.indexOf('--mount') + 2];
      observedEnv = options.env;
      options.registerCancellation(vi.fn());
      junit(invocation.cwd);
      return { exitCode: 0 };
    });
    const executor = new HerculesAutomationExecutor({
      workdir: root(),
      image: localImage,
      llmConfig: llmConfig(undefined, 'ollama'),
      processRunner,
    });

    await expect(
      executor.execute({
        executionId: 'ollama-local-image',
        snapshot: CANONICAL_FEATURE,
        environment: compatibilityEnvironment,
      })
    ).resolves.toMatchObject({ outcome: 'passed' });
    expect(observedImage).toBe(localImage);
    expect(processRunner.mock.calls[0][0].argv).not.toContain('LLM_MODEL_API_KEY');
    expect(observedEnv).toMatchObject({
      LLM_MODEL_NAME: 'fixture-model',
      LLM_MODEL_BASE_URL: 'https://llm.test/v1',
      LLM_MODEL_CLIENT_HOST: 'https://llm.test/v1',
      LLM_MODEL_API_TYPE: 'ollama',
    });
    expect(observedEnv).not.toHaveProperty('LLM_MODEL_API_KEY');
  });

  it('maps authenticated Ollama Cloud to the Ollama API with an inherited key marker', async () => {
    const cloudKey = ['fixture', 'cloud', 'key'].join('-');
    let observedEnv!: Record<string, string>;
    const processRunner = vi.fn(async (invocation, options) => {
      observedEnv = options.env;
      options.registerCancellation(vi.fn());
      junit(invocation.cwd);
      return { exitCode: 0 };
    });
    const executor = new HerculesAutomationExecutor({
      workdir: root(),
      llmConfig: llmConfig(cloudKey, 'ollama-cloud', 'https://ollama.com/api'),
      processRunner,
    });

    await expect(
      executor.execute({
        executionId: 'ollama-cloud',
        snapshot: CANONICAL_FEATURE,
        environment: compatibilityEnvironment,
      })
    ).resolves.toMatchObject({ outcome: 'passed' });
    expect(processRunner.mock.calls[0][0].argv).toContain('LLM_MODEL_API_KEY');
    expect(processRunner.mock.calls[0][0].argv.join(' ')).not.toContain(cloudKey);
    expect(observedEnv).toMatchObject({
      LLM_MODEL_NAME: 'fixture-model',
      LLM_MODEL_API_KEY: cloudKey,
      LLM_MODEL_BASE_URL: 'https://ollama.com/api',
      LLM_MODEL_CLIENT_HOST: 'https://ollama.com/api',
      LLM_MODEL_API_TYPE: 'ollama',
    });
  });

  it('propagates a named volume to execution and compatibility health', async () => {
    const volume = 'unittcms_hercules-work';
    let observedMount = '';
    const observedPathEnvironments: Readonly<Record<string, string>>[] = [];
    const processRunner = vi.fn(async (invocation, options) => {
      observedMount = invocation.argv[invocation.argv.indexOf('--mount') + 1];
      observedPathEnvironments.push(options.env);
      const projectBase = `/testzeus-hercules/opt/${basename(invocation.cwd)}`;
      expect(options.env).toMatchObject({
        PROJECT_SOURCE_ROOT: projectBase,
        INPUT_GHERKIN_FILE_PATH: `${projectBase}/input/test.feature`,
        JUNIT_XML_BASE_PATH: `${projectBase}/output`,
        TEST_DATA_PATH: `${projectBase}/test-data`,
      });
      options.registerCancellation(vi.fn());
      junit(invocation.cwd);
      return { exitCode: 0 };
    });
    const executor = new HerculesAutomationExecutor({
      workdir: root(),
      llmConfig: llmConfig(),
      workVolume: volume,
      processRunner,
    });

    await expect(
      executor.execute({
        executionId: 'volume-run',
        snapshot: CANONICAL_FEATURE,
        environment: compatibilityEnvironment,
      })
    ).resolves.toMatchObject({ outcome: 'passed' });
    await expect(
      executor.execute({
        executionId: 'volume-run-2',
        snapshot: CANONICAL_FEATURE,
        environment: compatibilityEnvironment,
      })
    ).resolves.toMatchObject({ outcome: 'passed' });
    expect(observedMount).toBe(`type=volume,src=${volume},dst=/testzeus-hercules/opt`);
    expect(observedPathEnvironments).toHaveLength(2);
    expect(new Set(observedPathEnvironments.map((environment) => environment.PROJECT_SOURCE_ROOT)).size).toBe(2);

    await expect(executor.health()).resolves.toEqual({ key: 'hercules', ready: true, status: 'ready' });
  });

  it('rejects an invalid named volume before execution setup', () => {
    expect(
      () => new HerculesAutomationExecutor({ workdir: root(), llmConfig: llmConfig(), workVolume: 'invalid/name' })
    ).toThrow('hercules_volume_invalid');
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
    const executor = new HerculesAutomationExecutor({ workdir: root(), llmConfig: llmConfig(), processRunner });

    await expect(
      executor.execute({
        executionId: `run-${outcome}`,
        snapshot: CANONICAL_FEATURE,
        environment: compatibilityEnvironment,
      })
    ).resolves.toMatchObject({ outcome });
  });

  it('maps process faults and timeout without returning process messages', async () => {
    const technical = new HerculesAutomationExecutor({
      workdir: root(),
      llmConfig: llmConfig(),
      processRunner: vi.fn(async () => {
        throw Object.assign(new Error('fixture process detail'), { code: 'EIO' });
      }),
    });
    await expect(
      technical.execute({
        executionId: 'technical',
        snapshot: CANONICAL_FEATURE,
        environment: compatibilityEnvironment,
      })
    ).resolves.toEqual({
      outcome: 'technical_error',
      error: 'hercules_process_failed',
    });

    const timeout = new HerculesAutomationExecutor({
      workdir: root(),
      llmConfig: llmConfig(),
      processRunner: vi.fn(async () => {
        throw Object.assign(new Error('fixture timeout detail'), { code: 'ETIMEDOUT' });
      }),
    });
    await expect(
      timeout.execute({ executionId: 'timeout', snapshot: CANONICAL_FEATURE, environment: compatibilityEnvironment })
    ).resolves.toEqual({
      outcome: 'timeout',
      error: 'hercules_timeout',
    });

    const secret = ['fixture', 'value'].join('-');
    const redacted = new HerculesAutomationExecutor({
      workdir: root(),
      llmConfig: llmConfig(),
      processRunner: vi.fn(async (invocation, options) => {
        options.registerCancellation(vi.fn());
        junit(invocation.cwd);
        writeFileSync(join(invocation.cwd, 'output', 'scenario.xml'), `password=${secret}`);
        return { exitCode: 0 };
      }),
    });
    await expect(
      redacted.execute({ executionId: 'redacted', snapshot: CANONICAL_FEATURE, environment: compatibilityEnvironment })
    ).resolves.toEqual({
      outcome: 'technical_error',
      error: 'evidence_secret_detected',
      errorKind: 'evidence',
    });
  });

  it.each([
    ['missing', () => undefined, 'evidence_junit_missing'],
    ['empty', (cwd: string) => {
      mkdirSync(join(cwd, 'output'), { recursive: true });
      writeFileSync(join(cwd, 'output', 'scenario.xml'), '');
    }, 'evidence_junit_invalid'],
    ['malformed', (cwd: string) => {
      mkdirSync(join(cwd, 'output'), { recursive: true });
      writeFileSync(join(cwd, 'output', 'scenario.xml'), '<testsuite tests="1" failures="0" errors="0">');
    }, 'evidence_junit_invalid'],
    ['no-testcase', (cwd: string) => {
      mkdirSync(join(cwd, 'output'), { recursive: true });
      writeFileSync(join(cwd, 'output', 'scenario.xml'), '<testsuite tests="1" failures="0" errors="0"></testsuite>');
    }, 'evidence_junit_invalid'],
    ['mismatched-test-count', (cwd: string) => {
      mkdirSync(join(cwd, 'output'), { recursive: true });
      writeFileSync(
        join(cwd, 'output', 'scenario.xml'),
        '<testsuite tests="2" failures="0" errors="0"><testcase/></testsuite>'
      );
    }, 'evidence_junit_invalid'],
  ] as const)('requires valid JUnit evidence for a zero exit (%s)', async (_name, writeEvidence, error) => {
    const processRunner = vi.fn(async (invocation, options) => {
      options.registerCancellation(vi.fn());
      writeEvidence(invocation.cwd);
      return { exitCode: 0 };
    });
    const executor = new HerculesAutomationExecutor({ workdir: root(), llmConfig: llmConfig(), processRunner });

    await expect(
      executor.execute({ executionId: `missing-evidence-${_name}`, snapshot: CANONICAL_FEATURE, environment: compatibilityEnvironment })
    ).resolves.toMatchObject({ outcome: 'technical_error', error, errorKind: 'evidence' });
  });

  it('accepts a valid nested JUnit result as pass evidence', async () => {
    const processRunner = vi.fn(async (invocation, options) => {
      options.registerCancellation(vi.fn());
      mkdirSync(join(invocation.cwd, 'output', 'run_1', 'run_2'), { recursive: true });
      writeFileSync(
        join(invocation.cwd, 'output', 'run_1', 'run_2', 'scenario.xml'),
        '<testsuite tests="1" failures="0" errors="0"><testcase/></testsuite>'
      );
      return { exitCode: 0 };
    });
    const executor = new HerculesAutomationExecutor({ workdir: root(), llmConfig: llmConfig(), processRunner });

    await expect(
      executor.execute({ executionId: 'nested-evidence', snapshot: CANONICAL_FEATURE, environment: compatibilityEnvironment })
    ).resolves.toMatchObject({ outcome: 'passed' });
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
    const executor = new HerculesAutomationExecutor({ workdir: root(), llmConfig: llmConfig(), processRunner });
    const running = executor.execute({
      executionId: 'cancel-me',
      snapshot: CANONICAL_FEATURE,
      environment: compatibilityEnvironment,
    });
    await vi.waitFor(() => expect(processRunner).toHaveBeenCalled());

    await executor.cancel('cancel-me');
    await expect(running).resolves.toEqual({ outcome: 'cancelled', error: 'hercules_cancelled' });
    await executor.cancel('cancel-me');
    await executor.cancel('unknown');
    expect(terminated).toHaveBeenCalledOnce();
  });

  it('binds the selected environment target and rejects case-controlled arbitrary URLs', async () => {
    const targetEnvironment = {
      baseUrl: 'https://qa.example.test/app',
      allowedHosts: ['qa.example.test', 'gateway.example.test'],
      secretRefs: [],
    };
    let feature = '';
    const processRunner = vi.fn(async (invocation, options) => {
      feature = readFileSync(join(invocation.cwd, 'input', 'test.feature'), 'utf8');
      options.registerCancellation(vi.fn());
      junit(invocation.cwd);
      return { exitCode: 0 };
    });
    const executor = new HerculesAutomationExecutor({ workdir: root(), llmConfig: llmConfig(), processRunner });
    await expect(
      executor.execute({
        executionId: 'target-binding',
        snapshot:
          'Feature: Target\n\n  Scenario: Target\n    Given I open the page "https://example.test/login"\n    When I inspect the page\n    Then the page is available\n',
        environment: targetEnvironment,
      })
    ).resolves.toMatchObject({ outcome: 'passed' });
    expect(feature).toContain('https://qa.example.test/app/login');
    expect(processRunner.mock.calls[0][1].env).toMatchObject({
      HERCULES_BASE_URL: 'https://qa.example.test/app',
      HERCULES_ALLOWED_HOSTS: 'qa.example.test,gateway.example.test',
    });

    await expect(
      executor.execute({
        executionId: 'saved-target',
        snapshot:
          'Feature: Target\n\n  Scenario: Target\n    Given I open the page "https://qa.example.test/login"\n    When I inspect the page\n    Then the page is available\n',
        environment: targetEnvironment,
      })
    ).resolves.toMatchObject({ outcome: 'passed' });
    expect(feature).toContain('https://qa.example.test/app/login');

    await expect(
      executor.execute({
        executionId: 'approved-gateway',
        snapshot:
          'Feature: Target\n\n  Scenario: Target\n    Given I open the page "https://gateway.example.test/sso/callback?state=fixture#done"\n    When I inspect the page\n    Then the page is available\n',
        environment: targetEnvironment,
      })
    ).resolves.toMatchObject({ outcome: 'passed' });
    expect(feature).toContain('https://gateway.example.test/sso/callback?state=fixture#done');

    await expect(
      executor.execute({
        executionId: 'arbitrary-target',
        snapshot:
          'Feature: Target\n\n  Scenario: Target\n    Given I open the page "https://evil.example.test"\n    When I inspect the page\n    Then the page is available\n',
        environment: targetEnvironment,
      })
    ).resolves.toEqual({ outcome: 'technical_error', error: 'environment_target_rejected' });
  });

  it('injects the resolved base URL into a URL-free parameterized Scenario Outline once', async () => {
    const targetEnvironment = {
      baseUrl: 'https://qa.example.test/app',
      allowedHosts: ['qa.example.test'],
      secretRefs: [],
    };
    let feature = '';
    const processRunner = vi.fn(async (invocation, options) => {
      feature = readFileSync(join(invocation.cwd, 'input', 'test.feature'), 'utf8');
      options.registerCancellation(vi.fn());
      junit(invocation.cwd);
      return { exitCode: 0 };
    });
    const executor = new HerculesAutomationExecutor({ workdir: root(), llmConfig: llmConfig(), processRunner });

    await expect(
      executor.execute({
        executionId: 'parameterized-target',
        snapshot:
          'Feature: Login\n\n  Scenario Outline: Login <user>\n    Given the user enters "<user>"\n    When the user submits the form\n    Then the dashboard is shown\n\n  Examples:\n    | user |\n    | Ada  |\n',
        environment: targetEnvironment,
      })
    ).resolves.toMatchObject({ outcome: 'passed' });

    expect(feature).toContain(
      '  Scenario Outline: Login <user>\n    Given I open the page "https://qa.example.test/app"\n    Given the user enters "<user>"'
    );
    expect(feature.match(/\bhttps?:\/\/[^\s"')]+/g)).toEqual(['https://qa.example.test/app']);
    expect(feature).not.toContain('example.com');
    expect(feature).not.toContain('/app/app');
  });

  it('rejects executions without a resolved environment before starting a process', async () => {
    const processRunner = vi.fn();
    const executor = new HerculesAutomationExecutor({ workdir: root(), llmConfig: llmConfig(), processRunner });
    await expect(executor.execute({ executionId: 'missing-target', snapshot: CANONICAL_FEATURE })).resolves.toEqual({
      outcome: 'technical_error',
      error: 'environment_required',
    });
    expect(processRunner).not.toHaveBeenCalled();
  });

  it('reports configuration readiness without invoking the compatibility gate', async () => {
    const gate = vi.spyOn(compatibility, 'runCompatibilityGate');
    const executor = new HerculesAutomationExecutor({ workdir: root(), llmConfig: llmConfig() });

    await expect(executor.health()).resolves.toEqual({ key: 'hercules', ready: true, status: 'ready' });
    expect(gate).not.toHaveBeenCalled();

    const registry = new NeutralExecutorRegistry();
    registry.register('hercules', executor);
    await expect(registry.select('hercules')).resolves.toBe(executor);
  });
});
