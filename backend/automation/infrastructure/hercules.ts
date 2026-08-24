import { spawn as defaultSpawn, type SpawnOptions } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  buildHerculesInvocation,
  CANONICAL_FEATURE,
  collectCompatibilityEvidence,
  HERCULES_CONTRACT,
  runCompatibilityGate,
  runHerculesProcess,
  validateCanonicalFeature,
} from '../compatibility/hercules.js';
import type { AutomationExecutor, ExecutorHealth, ExecutorInput, ExecutorResult } from '../ports/index.js';

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
export type HerculesCompatibilityGate = (input: {
  workdir: string;
  evidenceRoot: string;
  feature: string;
  allowedHosts: string[];
}) => Promise<{ ready: boolean }>;
export type HerculesExecutorOptions = {
  workdir: string;
  allowedHosts?: string[];
  timeoutMs?: number;
  liteLLM?: { baseUrl?: string; apiKey?: string };
  processRunner?: HerculesProcessRunner;
  compatibilityGate?: HerculesCompatibilityGate;
};

type CompatibilityInput = Parameters<HerculesCompatibilityGate>[0];

const FIXED_ENV = {
  AUTO_MODE: '1',
  ENABLE_TELEMETRY: '0',
  HEADLESS: String(HERCULES_CONTRACT.resourceLimits.browser.headless),
  BROWSER_TYPE: 'chromium',
  RECORD_VIDEO: 'true',
  TAKE_SCREENSHOTS: 'true',
  CAPTURE_NETWORK: 'true',
};

function safeEnvironment(liteLLM: HerculesExecutorOptions['liteLLM']): Record<string, string> {
  const env: Record<string, string> = { PATH: process.env.PATH ?? '/usr/bin:/bin', ...FIXED_ENV };
  if (liteLLM?.baseUrl) {
    const url = new URL(liteLLM.baseUrl);
    if (!['http:', 'https:'].includes(url.protocol)) throw new Error('invalid_litellm_base_url');
    env.LITELLM_BASE_URL = liteLLM.baseUrl;
  }
  if (liteLLM?.apiKey) env.LITELLM_API_KEY = liteLLM.apiKey;
  return Object.freeze(env);
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

const defaultCompatibilityGate: HerculesCompatibilityGate = (input: CompatibilityInput) =>
  (runCompatibilityGate as unknown as (value: CompatibilityInput) => Promise<{ ready: boolean }>)(input);

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
  private readonly allowedHosts: string[];
  private readonly timeoutMs: number;
  private readonly environment: Readonly<Record<string, string>>;
  private readonly processRunner: HerculesProcessRunner;
  private readonly compatibilityGate: HerculesCompatibilityGate;

  constructor(options: HerculesExecutorOptions) {
    this.workdir = options.workdir;
    mkdirSync(this.workdir, { recursive: true });
    this.allowedHosts = [...(options.allowedHosts ?? [])];
    const requested = options.timeoutMs ?? HERCULES_CONTRACT.timeoutMs;
    const maxTimeoutMs = Number(HERCULES_CONTRACT.timeoutMs);
    this.timeoutMs = Math.min(maxTimeoutMs, Math.max(1, Number.isFinite(requested) ? requested : 1));
    this.environment = safeEnvironment(options.liteLLM);
    this.processRunner = options.processRunner ?? defaultProcessRunner;
    this.compatibilityGate = options.compatibilityGate ?? defaultCompatibilityGate;
  }

  async execute(input: ExecutorInput): Promise<ExecutorResult> {
    const feature = typeof input.snapshot === 'string' ? input.snapshot : input.snapshot.feature;
    if (!validateCanonicalFeature(feature).valid)
      return { outcome: 'technical_error', error: 'invalid_canonical_feature' };
    const run: { cancelled: boolean; terminate: () => void } = { cancelled: false, terminate: () => {} };
    this.active.set(input.executionId, run);
    let workspace = '';
    try {
      workspace = mkdtempSync(join(this.workdir, 'run-'));
      mkdirSync(join(workspace, 'input'), { recursive: true });
      writeFileSync(join(workspace, 'input', 'test.feature'), feature, 'utf8');
      const registerCancellation = (terminate: () => void) => {
        run.terminate = terminate;
        if (run.cancelled) terminate();
      };
      const result = await this.processRunner(buildHerculesInvocation(workspace), {
        env: this.environment,
        timeoutMs: this.timeoutMs,
        registerCancellation,
      });
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
    try {
      const proof = await this.compatibilityGate({
        workdir: this.workdir,
        evidenceRoot: this.workdir,
        feature: CANONICAL_FEATURE,
        allowedHosts: this.allowedHosts,
      });
      return { key: 'hercules', ready: proof.ready, status: proof.ready ? 'ready' : 'compatibility_not_ready' };
    } catch {
      return { key: 'hercules', ready: false, status: 'compatibility_unavailable' };
    }
  }
}
