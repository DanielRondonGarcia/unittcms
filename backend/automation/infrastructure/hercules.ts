import { spawn as defaultSpawn, type SpawnOptions } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  buildHerculesInvocation,
  collectCompatibilityEvidence,
  HERCULES_CONTRACT,
  validateHostAllowlist,
  runHerculesProcess,
  validateCanonicalFeature,
  resolveHerculesImage,
  resolveHerculesVolume,
} from '../compatibility/hercules.js';
import type {
  AutomationExecutor,
  ExecutorHealth,
  ExecutorInput,
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
  allowedHosts?: string[];
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

function normalizedHosts(values: unknown): string[] {
  if (!Array.isArray(values)) return [];
  return [
    ...new Set(
      values
        .filter((value): value is string => typeof value === 'string')
        .map((value) => value.trim().toLowerCase().replace(/\.$/, ''))
    ),
  ].filter(Boolean);
}

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

export function bindEnvironmentTarget(feature: string, environment?: ResolvedEnvironment): BoundHerculesTarget {
  if (!environment || typeof environment.baseUrl !== 'string') throw new Error('environment_required');
  let baseUrl: URL;
  try {
    baseUrl = new URL(environment.baseUrl);
  } catch {
    throw new Error('environment_url_invalid');
  }
  const allowedHosts = normalizedHosts(environment.allowedHosts);
  if (!allowedHosts.length || !['http:', 'https:'].includes(baseUrl.protocol) || baseUrl.username || baseUrl.password)
    throw new Error('environment_target_rejected');
  if (!validateHostAllowlist([baseUrl.toString()], allowedHosts).allowed)
    throw new Error('environment_target_rejected');

  const urls = [...feature.matchAll(URL_PATTERN)].map(([value]) => value);
  const unsafeCaseUrls = urls.filter((value) => {
    try {
      const source = new URL(value);
      return (
        !['http:', 'https:'].includes(source.protocol) ||
        !FEATURE_TARGET_PLACEHOLDER_HOSTS.has(source.hostname.toLowerCase())
      );
    } catch {
      return true;
    }
  });
  if (unsafeCaseUrls.length > 0) throw new Error('environment_target_rejected');

  return Object.freeze({
    feature: feature.replace(URL_PATTERN, (value) => {
      try {
        return bindUrl(new URL(baseUrl.toString()), new URL(value));
      } catch {
        return value;
      }
    }),
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

function junitFlags(workdir: string): { failures: boolean; errors: boolean; secretFree: boolean } {
  const evidence = collectCompatibilityEvidence(workdir);
  const file = evidence.files.find((value: string) => /^output\/[^/]+\.xml$/i.test(value));
  if (!file) return { failures: false, errors: false, secretFree: evidence.secretFree };
  const text = readFileSync(join(workdir, file), 'utf8');
  return {
    failures: /<failure\b/i.test(text) || /failures\s*=\s*["'][1-9]\d*/i.test(text),
    errors: /<error\b/i.test(text) || /errors\s*=\s*["'][1-9]\d*/i.test(text),
    secretFree: evidence.secretFree,
  };
}

function mapProcessResult(result: HerculesProcessResult, workdir: string, cancelled: boolean): ExecutorResult {
  if (cancelled) return { outcome: 'cancelled', error: 'hercules_cancelled' };
  if (result.timedOut) return { outcome: 'timeout', error: 'hercules_timeout' };
  const junit = junitFlags(workdir);
  if (!junit.secretFree) return { outcome: 'technical_error', error: 'evidence_secret_detected' };
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
    this.workdir = options.workdir;
    mkdirSync(this.workdir, { recursive: true });
    const requested = options.timeoutMs ?? HERCULES_CONTRACT.timeoutMs;
    const maxTimeoutMs = Number(HERCULES_CONTRACT.timeoutMs);
    this.timeoutMs = Math.min(maxTimeoutMs, Math.max(1, Number.isFinite(requested) ? requested : 1));
    this.environment = safeEnvironment(options.llmConfig);
    this.processRunner = options.processRunner ?? defaultProcessRunner;
  }

  async execute(input: ExecutorInput): Promise<ExecutorResult> {
    const feature = typeof input.snapshot === 'string' ? input.snapshot : input.snapshot.feature;
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
        }),
        {
          env: Object.freeze({
            ...this.environment,
            RECORD_VIDEO: input.environment?.captureVideo === true ? 'true' : 'false',
            HERCULES_BASE_URL: target.baseUrl,
            HERCULES_ALLOWED_HOSTS: target.allowedHosts.join(','),
          }),
          timeoutMs: this.timeoutMs,
          registerCancellation,
        }
      );
      return mapProcessResult(result, workspace, run.cancelled);
    } catch (error) {
      if (run.cancelled) return { outcome: 'cancelled', error: 'hercules_cancelled' };
      if ((error as { code?: unknown })?.code === 'ETIMEDOUT') return { outcome: 'timeout', error: 'hercules_timeout' };
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
