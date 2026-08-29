import { spawn as defaultSpawn, type SpawnOptions } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import {
  buildHerculesInvocation,
  buildHerculesPathEnvironment,
  collectCompatibilityEvidence,
  collectExecutionArtifacts,
  HERCULES_CONTRACT,
  normalizeEnvironmentTarget,
  normalizeHostList,
  validateHostAllowlist,
  runHerculesProcess,
  validateCanonicalFeature,
  resolveHerculesImage,
  resolveHerculesVolume,
} from '../compatibility/hercules.js';
import { inspectCanonicalJUnit } from '../compatibility/hercules-proof.js';
import type {
  AutomationExecutor,
  ExecutorHealth,
  ExecutorInvocation,
  ExecutorResult,
  ResolvedEnvironment,
} from '../ports/index.js';
import { validateWorkerLlmConfig, type WorkerLlmConfig } from './llm-config.js';

export type HerculesInvocation = { file: string; cwd: string; argv: string[] };
export type HerculesProcessResult = { exitCode: number | null; signal?: string | null; timedOut?: boolean };
export type HerculesProcessRunner = (
  invocation: HerculesInvocation,
  options: {
    env: Readonly<Record<string, string>>;
    timeoutMs: number;
    registerCancellation: (terminate: () => void) => void;
  }
) => Promise<HerculesProcessResult>;
export type HerculesExecutorOptions = {
  workdir: string;
  timeoutMs?: number;
  llmConfig: WorkerLlmConfig;
  image?: string;
  workVolume?: string;
  processRunner?: HerculesProcessRunner;
};
export type BoundHerculesTarget = Readonly<{ feature: string; baseUrl: string; allowedHosts: string[] }>;

const FIXED_ENV = {
  AUTO_MODE: '1',
  ENABLE_TELEMETRY: '0',
  HEADLESS: String(HERCULES_CONTRACT.resourceLimits.browser.headless),
  BROWSER_TYPE: 'chromium',
  TAKE_SCREENSHOTS: 'true',
  CAPTURE_NETWORK: 'true',
};

function safeEnvironment(llmConfig: WorkerLlmConfig): Record<string, string> {
  const env: Record<string, string> = { PATH: process.env.PATH ?? '/usr/bin:/bin', ...FIXED_ENV };
  const config = validateWorkerLlmConfig(llmConfig);
  const apiType =
    config.provider === 'ollama' || config.provider === 'ollama-cloud'
      ? 'ollama'
      : config.provider === 'openai-compatible'
        ? 'openai'
        : undefined;
  if (!apiType) throw new Error('hercules_provider_unsupported');
  env.LLM_MODEL_NAME = config.model;
  if (config.provider !== 'ollama') env.LLM_MODEL_API_KEY = config.apiKey;
  env.LLM_MODEL_BASE_URL = config.baseUrl;
  if (apiType === 'ollama') env.LLM_MODEL_CLIENT_HOST = config.baseUrl;
  env.LLM_MODEL_API_TYPE = apiType;
  return Object.freeze(env);
}

const URL_PATTERN = /\b[a-z][a-z\d+.-]*:(?:\/\/)?[^\s"')]+/gi;
const FEATURE_TARGET_PLACEHOLDER_HOSTS = new Set(['example.com', 'example.test']);

function bindUrl(baseUrl: URL, sourceUrl: URL): string {
  const basePath = baseUrl.pathname.replace(/^\/+|\/+$/g, '');
  const sourcePath = sourceUrl.pathname.replace(/^\/+|\/+$/g, '');
  const path = [basePath, sourcePath].filter(Boolean).join('/');
  baseUrl.pathname = path ? `/${path}` : '/';
  baseUrl.search = sourceUrl.search;
  baseUrl.hash = sourceUrl.hash;
  if (!path && !baseUrl.search && !baseUrl.hash) return baseUrl.origin;
  return baseUrl.toString();
}

function injectInitialTarget(feature: string, baseUrl: string): string {
  const scenarioHeader = /(^[ \t]*Scenario(?: Outline)?:[^\r\n]*)(\r?\n)/m.exec(feature);
  if (!scenarioHeader || scenarioHeader.index === undefined) return feature;
  const insertionPoint = scenarioHeader.index + scenarioHeader[0].length;
  return `${feature.slice(0, insertionPoint)}    Given I open the page "${baseUrl}"${scenarioHeader[2]}${feature.slice(
    insertionPoint
  )}`;
}

export function bindEnvironmentTarget(feature: string, environment?: ResolvedEnvironment): BoundHerculesTarget {
  if (!environment || typeof environment.baseUrl !== 'string') throw new Error('environment_required');

  const configuredHosts = normalizeHostList(environment.allowedHosts);
  const normalizedBase = normalizeEnvironmentTarget(environment.baseUrl);
  const environmentHost = normalizedBase.allowedHosts[0];
  if (!configuredHosts.length || !configuredHosts.includes(environmentHost))
    throw new Error('environment_target_rejected');

  const target = normalizeEnvironmentTarget(environment.baseUrl, configuredHosts);
  let baseUrl: URL;
  try {
    baseUrl = new URL(target.baseUrl);
  } catch {
    throw new Error('environment_url_invalid');
  }
  const allowedHosts = target.allowedHosts;
  const urls = [...feature.matchAll(URL_PATTERN)].map(([value]) => value);
  const unsafeCaseUrls = urls.filter((value) => {
    try {
      const source = new URL(value);
      const sourceHost = normalizeHostList([source.hostname])[0];
      const placeholder = FEATURE_TARGET_PLACEHOLDER_HOSTS.has(sourceHost);
      return (
        !['http:', 'https:'].includes(source.protocol) ||
        source.username ||
        source.password ||
        (!placeholder && !allowedHosts.includes(sourceHost)) ||
        !validateHostAllowlist([value], placeholder ? [sourceHost] : allowedHosts).allowed
      );
    } catch {
      return true;
    }
  });
  if (unsafeCaseUrls.length > 0) throw new Error('environment_target_rejected');

  const boundFeature = feature.replace(URL_PATTERN, (value) => {
    try {
      const source = new URL(value);
      const sourceHost = normalizeHostList([source.hostname])[0];
      if (FEATURE_TARGET_PLACEHOLDER_HOSTS.has(sourceHost) || sourceHost === environmentHost)
        return bindUrl(new URL(baseUrl.toString()), source);
      return source.toString();
    } catch {
      return value;
    }
  });

  return Object.freeze({
    feature: urls.length > 0 ? boundFeature : injectInitialTarget(feature, baseUrl.toString()),
    baseUrl: baseUrl.toString(),
    allowedHosts,
  });
}

const executeCompatibilityProcess = runHerculesProcess as unknown as (
  invocation: HerculesInvocation,
  options: {
    timeoutMs: number;
    spawnImpl: (file: string, argv: string[], spawnOptions: SpawnOptions) => ReturnType<typeof defaultSpawn>;
  }
) => Promise<HerculesProcessResult>;

const defaultProcessRunner: HerculesProcessRunner = (invocation, options) =>
  executeCompatibilityProcess(invocation, {
    timeoutMs: options.timeoutMs,
    spawnImpl: (file: string, argv: string[], spawnOptions: SpawnOptions) => {
      const child = defaultSpawn(file, argv, { ...spawnOptions, env: options.env });
      options.registerCancellation(() => {
        if (child.pid) {
          try {
            process.kill(-child.pid, 'SIGKILL');
          } catch {
            // The process may already have exited.
          }
        }
      });
      return child;
    },
  });

const JUNIT_FILE_PATTERN = /^output\/(?:[^/\\]+\.xml|(?:run_[^/\\]+\/)+[^/\\]+\.xml)$/i;

type JunitFlags = {
  failures: boolean;
  errors: boolean;
  safe: boolean;
  valid: boolean;
  missing: boolean;
};

function junitDocumentFlags(text: string): { failures: boolean; errors: boolean; valid: boolean } {
  const inspected = inspectCanonicalJUnit(text);
  return {
    failures: inspected?.failures ?? false,
    errors: inspected?.errors ?? false,
    valid: inspected !== null,
  };
}

function junitFlags(workdir: string, evidence = collectCompatibilityEvidence(workdir)): JunitFlags {
  const files = evidence.files.filter((value: string) => JUNIT_FILE_PATTERN.test(value));
  const safe = evidence.executionSafe ?? evidence.secretFree;
  if (files.length === 0) return { failures: false, errors: false, safe, valid: false, missing: true };

  const documents = files.map((file: string) => {
    try {
      return junitDocumentFlags(readFileSync(join(workdir, file), 'utf8'));
    } catch {
      return { failures: false, errors: false, valid: false };
    }
  });
  return {
    failures: documents.some((document) => document.failures),
    errors: documents.some((document) => document.errors),
    safe,
    valid: documents.every((document) => document.valid),
    missing: false,
  };
}

function mapProcessResult(
  result: HerculesProcessResult,
  workdir: string,
  cancelled: boolean,
  evidence = collectCompatibilityEvidence(workdir)
): ExecutorResult {
  if (cancelled) return { outcome: 'cancelled', error: 'hercules_cancelled' };
  if (result.timedOut) return { outcome: 'timeout', error: 'hercules_timeout' };
  const junit = junitFlags(workdir, evidence);
  if (!junit.safe) return { outcome: 'technical_error', error: 'evidence_secret_detected', errorKind: 'evidence' };
  if (result.exitCode === 0 && junit.missing)
    return { outcome: 'technical_error', error: 'evidence_junit_missing', errorKind: 'evidence' };
  if (result.exitCode === 0 && !junit.valid)
    return { outcome: 'technical_error', error: 'evidence_junit_invalid', errorKind: 'evidence' };
  if (junit.errors) return { outcome: 'technical_error', error: 'hercules_result_error' };
  if (result.exitCode === 0) return { outcome: junit.failures ? 'functional_failure' : 'passed' };
  if (result.exitCode === 1) return { outcome: 'functional_failure' };
  return { outcome: 'technical_error', error: 'hercules_process_failed' };
}

export class HerculesAutomationExecutor implements AutomationExecutor {
  private readonly active = new Map<string, { cancelled: boolean; terminate: () => void }>();
  private readonly workdir: string;
  private readonly timeoutMs: number;
  private readonly image: string;
  private readonly workVolume: string | undefined;
  private readonly environment: Readonly<Record<string, string>>;
  private readonly processRunner: HerculesProcessRunner;

  constructor(options: HerculesExecutorOptions) {
    this.image = resolveHerculesImage(options.image);
    this.workVolume = options.workVolume === undefined ? undefined : resolveHerculesVolume(options.workVolume);
    this.workdir = resolve(options.workdir);
    mkdirSync(this.workdir, { recursive: true });
    const requested = options.timeoutMs ?? HERCULES_CONTRACT.timeoutMs;
    const maxTimeoutMs = Number(HERCULES_CONTRACT.timeoutMs);
    this.timeoutMs = Math.min(maxTimeoutMs, Math.max(1, Number.isFinite(requested) ? requested : 1));
    this.environment = safeEnvironment(options.llmConfig);
    this.processRunner = options.processRunner ?? defaultProcessRunner;
  }

  async execute(input: ExecutorInvocation): Promise<ExecutorResult> {
    const feature = typeof input.snapshot === 'string' ? input.snapshot : input.snapshot.feature;
    const captureVideo = input.environment?.captureVideo === true;
    if (!validateCanonicalFeature(feature).valid)
      return { outcome: 'technical_error', error: 'invalid_canonical_feature' };
    let target: BoundHerculesTarget;
    try {
      target = bindEnvironmentTarget(feature, input.environment);
    } catch (error) {
      const code = (error as { message?: unknown })?.message;
      return {
        outcome: 'technical_error',
        error:
          typeof code === 'string' &&
          ['environment_required', 'environment_url_invalid', 'environment_target_rejected'].includes(code)
            ? code
            : 'environment_target_rejected',
      };
    }
    const run: { cancelled: boolean; terminate: () => void } = { cancelled: false, terminate: () => {} };
    this.active.set(input.executionId, run);
    let workspace = '';
    try {
      workspace = mkdtempSync(join(this.workdir, 'run-'));
      mkdirSync(join(workspace, 'input'), { recursive: true });
      mkdirSync(join(workspace, 'test-data'), { recursive: true });
      writeFileSync(join(workspace, 'input', 'test.feature'), target.feature, 'utf8');
      const registerCancellation = (terminate: () => void) => {
        run.terminate = terminate;
        if (run.cancelled) terminate();
      };
      const result = await this.processRunner(
        buildHerculesInvocation(workspace, this.image, this.workVolume, {
          includeApiKey:
            this.environment.LLM_MODEL_API_TYPE !== 'ollama' ||
            Object.prototype.hasOwnProperty.call(this.environment, 'LLM_MODEL_API_KEY'),
          volumeRoot: this.workdir,
          captureVideo,
        }),
        {
          env: Object.freeze({
            ...this.environment,
            ...buildHerculesPathEnvironment(workspace, this.workVolume, this.workdir),
            RECORD_VIDEO: captureVideo ? 'true' : 'false',
            HERCULES_BASE_URL: target.baseUrl,
            HERCULES_ALLOWED_HOSTS: target.allowedHosts.join(','),
          }),
          timeoutMs: this.timeoutMs,
          registerCancellation,
        }
      );
      const allowLargeVideos = captureVideo;
      const secretValues = this.environment.LLM_MODEL_API_KEY ? [this.environment.LLM_MODEL_API_KEY] : [];
      const evidence = collectCompatibilityEvidence(workspace, { allowLargeVideos, secretValues });
      const mapped = mapProcessResult(result, workspace, run.cancelled, evidence);
      if (!(evidence.executionSafe ?? evidence.secretFree)) return mapped;
      const artifacts = collectExecutionArtifacts(workspace, {
        includeVideo: allowLargeVideos,
      });
      if (artifacts.length === 0) return mapped;
      if (input.artifactSink) {
        await input.artifactSink(artifacts);
        return mapped;
      }
      return { ...mapped, artifacts };
    } catch (error) {
      if (run.cancelled) return { outcome: 'cancelled', error: 'hercules_cancelled' };
      if ((error as { code?: unknown })?.code === 'ETIMEDOUT') return { outcome: 'timeout', error: 'hercules_timeout' };
      if ((error as { code?: unknown })?.code === 'artifact_persistence_failed') throw error;
      return { outcome: 'technical_error', error: 'hercules_process_failed' };
    } finally {
      this.active.delete(input.executionId);
      if (workspace) rmSync(workspace, { recursive: true, force: true });
    }
  }

  async cancel(executionId: string): Promise<void> {
    const run = this.active.get(executionId);
    if (!run) return;
    run.cancelled = true;
    try {
      run.terminate();
    } catch {
      // Cancellation remains recorded even when the child already exited.
    }
  }

  async health(): Promise<ExecutorHealth> {
    return { key: 'hercules', ready: true, status: 'ready' };
  }
}
