import { EventEmitter } from 'node:events';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  HERCULES_CONTRACT,
  HERCULES_LLM_ENV_NAMES,
  HERCULES_PATH_ENV_NAMES,
  runHerculesProcess,
  validateHostAllowlist,
} from './hercules.js';

export const HERCULES_PROOF_SOURCE = 'unittcms-hercules-proof/v1';

const JUNIT_FILE_PATTERN = /^output\/(?:[^/\\]+\.xml|(?:run_[^/\\]+\/)+[^/\\]+\.xml)$/i;
const URL_PATTERN = /\b[a-z][a-z\d+.-]*:(?:\/\/)?[^\s"')]+/gi;

function isNonEmptyString(value) {
  return typeof value === 'string' && value.trim().length > 0;
}

function parseJunitArguments(first, second) {
  if (typeof first === 'number') return { exitCode: first, xml: second };
  if (first && typeof first === 'object' && !Array.isArray(first)) {
    return { exitCode: first.exitCode, xml: first.xml ?? first.text };
  }
  return { exitCode: second, xml: first };
}

/**
 * Parse a canonical JUnit document without treating an exit code alone as a pass.
 * The object-form input is useful at the process/evidence boundary; the positional
 * forms keep this parser convenient for focused unit tests.
 */
export function parseCanonicalJUnit(first, second) {
  const { exitCode, xml } = parseJunitArguments(first, second);
  if (exitCode !== 0 || !isNonEmptyString(xml)) return null;
  if (!/<testsuites?\b/i.test(xml)) return null;

  const trimmed = xml.trim();
  if (!/<\/testsuites?>\s*$/i.test(trimmed) && !/<testsuites?\b[^>]*\/>\s*$/i.test(trimmed)) return null;
  const counts = { failures: [], errors: [] };
  for (const match of xml.matchAll(/\b(failures|errors)\s*=\s*(['"])(\d+)\2/gi)) {
    counts[match[1].toLowerCase()].push(Number(match[3]));
  }
  if (!counts.failures.length || !counts.errors.length) return null;
  if (counts.failures.some((count) => count !== 0) || counts.errors.some((count) => count !== 0)) return null;
  if (/<(?:failure|error)\b/i.test(xml)) return null;

  return { exitCode: 0, result: 'passed' };
}

function invocationArgv(context) {
  const value = context.invocationArgv ?? context.argv ?? context.invocation;
  if (Array.isArray(value)) return value;
  return Array.isArray(value?.argv) ? value.argv : [];
}

function expectedContractArgv(includeApiKey) {
  if (includeApiKey) return HERCULES_CONTRACT.argv;
  const args = [...HERCULES_CONTRACT.argv];
  const keyIndex = args.indexOf('LLM_MODEL_API_KEY');
  args.splice(keyIndex - 1, 2);
  return args;
}

function hasFixedInvocationArgs(argv, includeApiKey = true) {
  return expectedContractArgv(includeApiKey).every((value, index) => argv[index] === value);
}

function hasInvocationEnv(argv, name, expectedValue) {
  return argv.some((value, index) => value === '--env' && argv[index + 1] === `${name}=${expectedValue}`);
}

function hasInvocationEnvName(argv, name) {
  return argv.some((value, index) => value === '--env' && argv[index + 1] === name);
}

function observedPassResult(context) {
  return (
    context.passResult ??
    context.passExecutionResult ??
    context.passExecution ??
    context.executionResult ??
    context.execution
  );
}

function failureProbeResult(probe) {
  const exitCode = typeof probe?.exitCode === 'number' ? probe.exitCode : null;
  const result = probe?.result ?? (exitCode === 1 ? 'failed' : 'unknown');
  return { exitCode, result };
}

function timeoutProbePassed(probe) {
  const errorCode = probe?.errorCode ?? probe?.code ?? probe?.error?.code;
  const killObserved = probe?.killInvoked === true || probe?.killCalled === true || probe?.killed === true;
  return errorCode === 'ETIMEDOUT' && killObserved;
}

function evidenceProof(evidence) {
  const binaryScan = evidence?.binaryScan;
  const completeEvidence = Array.isArray(evidence?.missing) && evidence.missing.length === 0;
  const completeBinaryScan =
    binaryScan?.complete === true &&
    Array.isArray(binaryScan?.scannedFiles) &&
    Array.isArray(binaryScan?.unscannedFiles) &&
    Array.isArray(binaryScan?.suspiciousFiles) &&
    binaryScan.suspiciousFiles.length === 0;
  return {
    secretAbsenceVerified: completeEvidence && evidence?.secretFree === true && completeBinaryScan,
    binaryEvidenceVerified: completeEvidence && completeBinaryScan,
  };
}

function hasApiKey(runtimeEnv) {
  return typeof runtimeEnv.LLM_MODEL_API_KEY === 'string' && runtimeEnv.LLM_MODEL_API_KEY.trim().length > 0;
}

function isOllamaCloudEndpoint(value) {
  try {
    const url = new URL(value);
    return (
      url.origin === 'https://ollama.com' &&
      ['/api', '/api/'].includes(url.pathname) &&
      !url.username &&
      !url.password &&
      !url.search &&
      !url.hash
    );
  } catch {
    return false;
  }
}

function keylessOllama(runtimeEnv) {
  return (
    runtimeEnv.LLM_MODEL_API_TYPE === 'ollama' &&
    !hasApiKey(runtimeEnv) &&
    !isOllamaCloudEndpoint(runtimeEnv.LLM_MODEL_BASE_URL)
  );
}

function authenticatedOllamaCloud(runtimeEnv) {
  return (
    runtimeEnv.LLM_MODEL_API_TYPE === 'ollama' &&
    hasApiKey(runtimeEnv) &&
    isOllamaCloudEndpoint(runtimeEnv.LLM_MODEL_BASE_URL) &&
    runtimeEnv.LLM_MODEL_CLIENT_HOST === runtimeEnv.LLM_MODEL_BASE_URL
  );
}

function validLlmRuntime(runtimeEnv) {
  if (
    !['LLM_MODEL_NAME', 'LLM_MODEL_BASE_URL', 'LLM_MODEL_API_TYPE'].every((name) => isNonEmptyString(runtimeEnv[name]))
  )
    return false;
  if (runtimeEnv.LLM_MODEL_API_TYPE === 'ollama')
    return keylessOllama(runtimeEnv) || authenticatedOllamaCloud(runtimeEnv);
  return isNonEmptyString(runtimeEnv.LLM_MODEL_API_KEY);
}

function readCanonicalJUnit(evidenceRoot, evidence) {
  if (!isNonEmptyString(evidenceRoot) || !Array.isArray(evidence?.files)) return null;
  const file = evidence.files.find((value) => typeof value === 'string' && JUNIT_FILE_PATTERN.test(value));
  if (!file) return null;
  try {
    return readFileSync(join(evidenceRoot, file), 'utf8');
  } catch {
    return null;
  }
}

/**
 * Build proof solely from observed execution, process-boundary, invocation, runtime,
 * allowlist, and evidence inputs. Failed observations intentionally produce values
 * that the existing evaluator rejects instead of being replaced with assumptions.
 */
export function buildCompatibilityProof(context = {}) {
  const passCandidate = observedPassResult(context);
  const pass =
    passCandidate?.exitCode === 0 && passCandidate?.result === 'passed' ? { exitCode: 0, result: 'passed' } : null;
  const failure = failureProbeResult(context.failureProbe ?? context.failureResult);
  const failurePassed = failure.exitCode === 1 && failure.result === 'failed';
  const argv = invocationArgv(context);
  const runtimeEnv = context.runtimeEnv ?? {};
  const keyless = keylessOllama(runtimeEnv);
  const fixedArgsVerified = hasFixedInvocationArgs(argv, !keyless);
  const browserArgsVerified =
    fixedArgsVerified &&
    hasInvocationEnv(argv, 'HEADLESS', 'true') &&
    hasInvocationEnv(argv, 'BROWSER_TYPE', 'chromium');
  const llmRuntimeVerified =
    fixedArgsVerified &&
    HERCULES_LLM_ENV_NAMES.filter((name) => !keyless || name !== 'LLM_MODEL_API_KEY').every((name) =>
      hasInvocationEnvName(argv, name)
    ) &&
    validLlmRuntime(runtimeEnv);
  const pathEnvironmentVerified =
    fixedArgsVerified &&
    HERCULES_PATH_ENV_NAMES.every((name) => hasInvocationEnvName(argv, name) && isNonEmptyString(runtimeEnv[name]));
  const urls = [...String(context.feature ?? '').matchAll(URL_PATTERN)].map(([url]) => url);
  const hostAllowlistVerified =
    urls.length > 0 && Array.isArray(context.allowedHosts) && validateHostAllowlist(urls, context.allowedHosts).allowed;
  const evidence = evidenceProof(context.evidence);
  const result = pass ?? {
    exitCode: typeof passCandidate?.exitCode === 'number' ? passCandidate.exitCode : null,
    result: 'failed',
  };

  return {
    result,
    proof: {
      exitSemantics: {
        pass,
        fail: { exitCode: failure.exitCode, result: failurePassed ? 'failed' : 'unknown' },
      },
      timeoutHardKill: timeoutProbePassed(context.timeoutProbe ?? context.timeoutResult),
      browserLimits: {
        headless: browserArgsVerified ? HERCULES_CONTRACT.resourceLimits.browser.headless : false,
        maxConcurrentPages: browserArgsVerified ? HERCULES_CONTRACT.resourceLimits.browser.maxConcurrentPages : 0,
      },
      llmLimits: {
        maxRequests: llmRuntimeVerified ? HERCULES_CONTRACT.resourceLimits.llm.maxRequests : 0,
        maxTokens: llmRuntimeVerified ? HERCULES_CONTRACT.resourceLimits.llm.maxTokens : 0,
      },
      pathEnvironmentVerified,
      telemetryDisabled: fixedArgsVerified && hasInvocationEnv(argv, 'ENABLE_TELEMETRY', '0'),
      hostAllowlistVerified,
      secretAbsenceVerified: evidence.secretAbsenceVerified,
      binaryEvidenceVerified: evidence.binaryEvidenceVerified,
      verificationSource: HERCULES_PROOF_SOURCE,
    },
  };
}

async function runFailureProbe(invocation, runtimeEnv) {
  const failureEnv = Object.fromEntries(
    Object.entries(runtimeEnv ?? {}).filter(([name]) => !HERCULES_LLM_ENV_NAMES.includes(name))
  );
  try {
    const result = await runHerculesProcess(invocation, { env: failureEnv });
    return { exitCode: result.exitCode, result: result.exitCode === 1 ? 'failed' : 'unknown' };
  } catch (error) {
    return { exitCode: null, result: 'unknown', errorCode: error?.code };
  }
}

async function runTimeoutProbe(invocation) {
  const child = Object.assign(new EventEmitter(), { pid: 73 });
  let killInvoked = false;
  try {
    await runHerculesProcess(invocation, {
      spawnImpl: () => child,
      timeoutMs: Math.min(50, HERCULES_CONTRACT.timeoutMs),
      killProcessGroup: () => {
        killInvoked = true;
      },
    });
    return { errorCode: null, killInvoked };
  } catch (error) {
    return { errorCode: error?.code, killInvoked };
  }
}

/**
 * Execute the independent failure and timeout checks for the real compatibility run.
 * Child output is ignored by runHerculesProcess and probe errors are represented as
 * failed observations so no process message can enter the diagnostic response.
 */
export async function createCompatibilityProof(context = {}) {
  const passXml = readCanonicalJUnit(context.evidenceRoot, context.evidence);
  const passResult = parseCanonicalJUnit({ xml: passXml, exitCode: context.execution?.exitCode });
  const [failureProbe, timeoutProbe] = await Promise.all([
    runFailureProbe(context.invocation, context.runtimeEnv),
    runTimeoutProbe(context.invocation),
  ]);
  return buildCompatibilityProof({ ...context, passResult, failureProbe, timeoutProbe });
}
