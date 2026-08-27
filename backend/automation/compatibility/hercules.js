import { execFile as defaultExecFile, spawn as defaultSpawn } from 'node:child_process';
import { mkdirSync, readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { isIP } from 'node:net';
import { dirname, join, relative, resolve } from 'node:path';
const HERCULES_IMAGE =
  'testzeus/hercules:0.1.2@sha256:11ff3700104f92230bafdff1e85f43b8932e8a7df5ab85b7f7d00d3cea61f52c';
const HERCULES_IMAGE_COMPONENT = '[a-z0-9]+(?:[._]|__|[-]*[a-z0-9]+)*';
const HERCULES_IMAGE_PATTERN = new RegExp(
  `^(?=.{1,255}$)(?:${HERCULES_IMAGE_COMPONENT}(?::[0-9]+)?\\/)?${HERCULES_IMAGE_COMPONENT}(?:\\/${HERCULES_IMAGE_COMPONENT})*(?::[\\w][\\w.-]{0,127})?(?:@sha256:[a-f0-9]{64})?$`
);
const HERCULES_VOLUME_PATTERN = /^[a-zA-Z0-9][a-zA-Z0-9_.-]+$/;
export const HERCULES_LLM_ENV_NAMES = Object.freeze([
  'LLM_MODEL_NAME',
  'LLM_MODEL_API_KEY',
  'LLM_MODEL_BASE_URL',
  'LLM_MODEL_CLIENT_HOST',
  'LLM_MODEL_API_TYPE',
]);
export const HERCULES_TARGET_ENV_NAMES = Object.freeze(['HERCULES_BASE_URL', 'HERCULES_ALLOWED_HOSTS']);
export const HERCULES_PATH_ENV_NAMES = Object.freeze([
  'PROJECT_SOURCE_ROOT',
  'INPUT_GHERKIN_FILE_PATH',
  'JUNIT_XML_BASE_PATH',
  'TEST_DATA_PATH',
]);
const FIXED_DOCKER_ARGS = [
  'run',
  '--rm',
  '--init',
  '--cpus=2',
  '--memory=4g',
  '--pids-limit=256',
  '--env',
  'AUTO_MODE=1',
  '--env',
  'ENABLE_TELEMETRY=0',
  '--env',
  'HEADLESS=true',
  '--env',
  'BROWSER_TYPE=chromium',
  '--env',
  'RECORD_VIDEO=true',
  '--env',
  'TAKE_SCREENSHOTS=true',
  '--env',
  'CAPTURE_NETWORK=true',
  ...HERCULES_LLM_ENV_NAMES.flatMap((name) => ['--env', name]),
  ...HERCULES_TARGET_ENV_NAMES.flatMap((name) => ['--env', name]),
  ...HERCULES_PATH_ENV_NAMES.flatMap((name) => ['--env', name]),
];

function dockerArgs(includeApiKey = true) {
  if (includeApiKey) return FIXED_DOCKER_ARGS;
  const args = [...FIXED_DOCKER_ARGS];
  const keyIndex = args.indexOf('LLM_MODEL_API_KEY');
  args.splice(keyIndex - 1, 2);
  return args;
}
function shouldIncludeApiKey(runtimeEnv = {}) {
  return (
    runtimeEnv.LLM_MODEL_API_TYPE !== 'ollama' ||
    (typeof runtimeEnv.LLM_MODEL_API_KEY === 'string' && runtimeEnv.LLM_MODEL_API_KEY.trim().length > 0)
  );
}
const EVIDENCE_PATTERNS = {
  junit: /^output\/(?:[^/\\]+\.xml|(?:run_[^/\\]+\/)+[^/\\]+\.xml)$/i,
  html: /^output\/(?:[^/\\]+\.html|(?:run_[^/\\]+\/)+[^/\\]+\.html)$/i,
  screenshots: /^proofs\/[^/]+\/run_[^/]+\/screenshots\/.+\.(?:png|jpe?g)$/i,
  videos: /^proofs\/[^/]+\/run_[^/]+\/videos\/.+\.(?:webm|mp4)$/i,
  logs: /^log_files\/.+/i,
  network: /^proofs\/[^/]+\/run_[^/]+\/network_logs\.json$/i,
  planner: /^log_files\/[^/]+\/run_[^/]+\/agent_inner_thoughts\.json$/i,
};
const EXECUTION_ARTIFACTS = [
  { kind: 'junit', mimeType: 'application/xml', pattern: EVIDENCE_PATTERNS.junit },
  { kind: 'html', mimeType: 'text/html', pattern: EVIDENCE_PATTERNS.html },
  { kind: 'screenshot', mimeType: 'image/png', pattern: EVIDENCE_PATTERNS.screenshots },
  { kind: 'video', mimeType: 'video/webm', pattern: EVIDENCE_PATTERNS.videos },
  { kind: 'network', mimeType: 'application/json', pattern: EVIDENCE_PATTERNS.network },
  { kind: 'planner', mimeType: 'application/json', pattern: EVIDENCE_PATTERNS.planner },
  { kind: 'log', mimeType: 'text/plain', pattern: EVIDENCE_PATTERNS.logs },
];
const LOG_MIME_TYPES = Object.freeze({
  '.json': 'application/json',
  '.log': 'text/plain',
  '.txt': 'text/plain',
});
const TEXT_EVIDENCE = /\.(?:xml|html|json|log|txt)$/i;
const MAX_BINARY_SCAN_BYTES = 1024 * 1024;
const HERCULES_CONTAINER_ROOT = '/testzeus-hercules/opt';
const SAFE_CONTAINER_PATH_PART = /^[A-Za-z0-9._-]+$/;
const LOCAL_HOSTNAMES = new Set([
  'local',
  'localhost',
  'localhost.localdomain',
  'ip6-localhost',
  'ip6-loopback',
  'metadata',
  'metadata.google.internal',
  'instance-data.ec2.internal',
  'host.docker.internal',
]);
export const HERCULES_CONTRACT = Object.freeze({
  release: '0.1.2',
  image: HERCULES_IMAGE,
  argv: Object.freeze(FIXED_DOCKER_ARGS),
  timeoutMs: 300_000,
  resourceLimits: Object.freeze({
    container: Object.freeze({ cpus: 2, memory: '4g', pids: 256 }),
    browser: Object.freeze({ headless: true, maxConcurrentPages: 1 }),
    llm: Object.freeze({ maxRequests: 10, maxTokens: 4096 }),
  }),
});
function hasControlCharacter(value) {
  return [...value].some((character) => {
    const code = character.charCodeAt(0);
    return code <= 0x1f || code === 0x7f;
  });
}
export function resolveHerculesImage(value) {
  if (value === undefined || value === '') return HERCULES_IMAGE;
  if (
    typeof value !== 'string' ||
    /\s/.test(value) ||
    hasControlCharacter(value) ||
    !HERCULES_IMAGE_PATTERN.test(value)
  )
    throw new Error('hercules_image_invalid');
  return value;
}
export function resolveHerculesVolume(value) {
  if (value === undefined) return undefined;
  if (
    typeof value !== 'string' ||
    value.length < 2 ||
    value.length > 255 ||
    /\s/.test(value) ||
    hasControlCharacter(value) ||
    !HERCULES_VOLUME_PATTERN.test(value)
  )
    throw new Error('hercules_volume_invalid');
  return value;
}
export const CANONICAL_FEATURE = `Feature: UnitTCMS compatibility

  Scenario: Open the allowed test page
    Given I open the page "https://example.com"
    When I inspect the page
    Then the page is available
`;
export function validateCanonicalFeature(feature) {
  const text = String(feature ?? '');
  const steps = [...text.matchAll(/^\s*(Given|When|Then|And|But)\b/gm)].map((match) => match[1]);
  const localized = /\b(?:Dado|Cuando|Entonces|Y|Pero)\b/i.test(text);
  const valid =
    /^\s*Feature:\s*\S+/m.test(text) &&
    /^\s*Scenario(?: Outline)?:\s*\S+/m.test(text) &&
    !localized &&
    ['Given', 'When', 'Then'].every((keyword) => steps.includes(keyword));
  return {
    valid,
    errors: valid
      ? []
      : ['feature must contain English Feature, Scenario or Scenario Outline, Given, When, and Then keywords'],
  };
}
function volumeProjectRoot(workspace, volumeRoot) {
  if (typeof volumeRoot !== 'string' || !volumeRoot.trim()) throw new Error('hercules_workspace_invalid');
  const relativeWorkspace = relative(resolve(volumeRoot), workspace).replaceAll('\\', '/');
  const parts = relativeWorkspace.split('/');
  if (
    !relativeWorkspace ||
    relativeWorkspace === '.' ||
    relativeWorkspace === '..' ||
    relativeWorkspace.startsWith('../') ||
    relativeWorkspace.startsWith('/') ||
    parts.some((part) => part === '.' || part === '..' || !SAFE_CONTAINER_PATH_PART.test(part))
  )
    throw new Error('hercules_workspace_invalid');
  return `${HERCULES_CONTAINER_ROOT}/${relativeWorkspace}`;
}

function resolveHerculesProjectRoot(workspace, workVolume, volumeRoot) {
  return workVolume === undefined ? HERCULES_CONTAINER_ROOT : volumeProjectRoot(resolve(workspace), volumeRoot);
}

/**
 * @param {string} workdir
 * @param {string | undefined} workVolume
 * @param {string | undefined} volumeRoot
 */
export function buildHerculesPathEnvironment(workdir, workVolume, volumeRoot) {
  const selectedVolume = workVolume === undefined ? undefined : resolveHerculesVolume(workVolume);
  const projectRoot = resolveHerculesProjectRoot(workdir, selectedVolume, volumeRoot);
  return Object.freeze({
    PROJECT_SOURCE_ROOT: projectRoot,
    INPUT_GHERKIN_FILE_PATH: `${projectRoot}/input/test.feature`,
    JUNIT_XML_BASE_PATH: `${projectRoot}/output`,
    TEST_DATA_PATH: `${projectRoot}/test-data`,
  });
}

/**
 * @param {string} workdir
 * @param {string | undefined} image
 * @param {string | undefined} workVolume
 * @param {{ includeApiKey?: boolean, volumeRoot?: string }} [options]
 */
export function buildHerculesInvocation(workdir, image, workVolume, options = {}) {
  const { includeApiKey = true, volumeRoot } = options;
  const cwd = resolve(workdir);
  if (/[\r\n,]/.test(cwd)) {
    throw new Error('compatibility workspace path contains unsafe mount characters');
  }
  const selectedImage = resolveHerculesImage(image);
  const selectedVolume = workVolume === undefined ? undefined : resolveHerculesVolume(workVolume);
  const mount = selectedVolume
    ? `type=volume,src=${selectedVolume},dst=${HERCULES_CONTAINER_ROOT}`
    : `type=bind,src=${cwd},dst=${HERCULES_CONTAINER_ROOT}`;
  resolveHerculesProjectRoot(cwd, selectedVolume, volumeRoot);
  return {
    file: 'docker',
    cwd,
    argv: [...dockerArgs(includeApiKey), '--mount', mount, selectedImage],
  };
}
function defaultKillProcessGroup(pid, signal, platform, execFileImpl) {
  if (platform === 'win32') {
    const numericPid = Math.abs(pid);
    if (!Number.isSafeInteger(numericPid) || numericPid === 0) return;
    execFileImpl('taskkill', ['/PID', String(numericPid), '/T', '/F'], { shell: false, windowsHide: true }, () => {});
    return;
  }
  process.kill(pid, signal);
}
export function runHerculesProcess(
  invocation,
  {
    spawnImpl = defaultSpawn,
    timeoutMs = HERCULES_CONTRACT.timeoutMs,
    killProcessGroup,
    platform = process.platform,
    execFileImpl = defaultExecFile,
    env: runtimeEnv = {},
  } = {}
) {
  const terminateProcess =
    killProcessGroup ?? ((pid, signal) => defaultKillProcessGroup(pid, signal, platform, execFileImpl));
  return new Promise((resolveResult, reject) => {
    let timer;
    let settled = false;
    const finish = (callback, value) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      callback(value);
    };
    let child;
    try {
      child = spawnImpl(invocation.file, invocation.argv, {
        cwd: invocation.cwd,
        env: { PATH: process.env.PATH ?? '/usr/bin:/bin', ...runtimeEnv },
        shell: false,
        detached: true,
        stdio: ['ignore', 'ignore', 'ignore'],
      });
    } catch (error) {
      finish(reject, error);
      return;
    }
    child.once('error', (error) => finish(reject, error));
    child.once('close', (exitCode, signal) => finish(resolveResult, { exitCode, signal }));
    timer = setTimeout(() => {
      try {
        if (child.pid) terminateProcess(-child.pid, 'SIGKILL');
      } catch {
        // The process may already have exited before termination completed.
      }
      const error = new Error(`Hercules compatibility process exceeded ${timeoutMs}ms`);
      error.code = 'ETIMEDOUT';
      finish(reject, error);
    }, timeoutMs);
  });
}
function listFiles(root, current = root) {
  return readdirSync(current, { withFileTypes: true }).flatMap((entry) => {
    const absolute = join(current, entry.name);
    if (entry.isDirectory()) return listFiles(root, absolute);
    if (entry.isFile()) return [relative(root, absolute).replaceAll('\\', '/')];
    return [];
  });
}
function containsSecretMaterial(text) {
  return (
    /\b(?:password|api[_ -]?key|authorization|token)\s*[:=]\s*(?!<[^>]+>|redacted|placeholder|replace-me)[^\s"',;]+/i.test(
      text
    ) ||
    /\bBearer\s+(?!<[^>]+>|redacted)[A-Za-z0-9._~-]{12,}/i.test(text) ||
    /\bsk-[A-Za-z0-9_-]{12,}\b/.test(text)
  );
}
function containsSecretBytes(bytes, secretValues = []) {
  const value = Buffer.from(bytes);
  return (
    containsSecretMaterial(value.toString('latin1')) ||
    secretValues.some((secret) => typeof secret === 'string' && secret && value.includes(Buffer.from(secret, 'utf8')))
  );
}
function isUnsafeLiteralTarget(hostname) {
  const address = hostname.replace(/^\[|\]$/g, '');
  const family = isIP(address);
  if (family === 4) {
    const [first, second] = address.split('.').map(Number);
    return (
      [0, 10, 127].includes(first) ||
      (first === 169 && second === 254) ||
      (first === 172 && second >= 16 && second <= 31) ||
      (first === 192 && second === 168)
    );
  }
  return family === 6 && /^(?:::|fc|fd|fe[89ab])/i.test(address);
}
/**
 * @param {string} root
 * @param {{ allowLargeVideos?: boolean, secretValues?: string[] }} [options]
 */
export function collectCompatibilityEvidence(root, options = {}) {
  const { allowLargeVideos = false, secretValues = [] } = options;
  const files = listFiles(root);
  const missing = Object.entries(EVIDENCE_PATTERNS)
    .filter(([, pattern]) => !files.some((file) => pattern.test(file)))
    .map(([name]) => name);
  const textFiles = files.filter((file) => TEXT_EVIDENCE.test(file));
  const binaryFiles = files.filter((file) => !TEXT_EVIDENCE.test(file));
  const text = textFiles.map((file) => readFileSync(join(root, file), 'utf8')).join('\n');
  const binaryScan = {
    complete: true,
    scannedFiles: [],
    suspiciousFiles: [],
    unscannedFiles: [],
  };
  for (const file of binaryFiles) {
    const path = join(root, file);
    const size = statSync(path).size;
    if (size > MAX_BINARY_SCAN_BYTES) {
      binaryScan.complete = false;
      binaryScan.unscannedFiles.push(file);
      continue;
    }
    binaryScan.scannedFiles.push(file);
    if (containsSecretBytes(readFileSync(path), secretValues)) binaryScan.suspiciousFiles.push(file);
  }
  const evidence = {
    files,
    missing,
    textFiles,
    binaryFiles,
    binaryScan,
    secretFree: !containsSecretMaterial(text) && binaryScan.complete && binaryScan.suspiciousFiles.length === 0,
  };
  if (allowLargeVideos || secretValues.length > 0) {
    evidence.executionSafe =
      !containsSecretMaterial(text) &&
      binaryScan.suspiciousFiles.length === 0 &&
      binaryScan.unscannedFiles.every((file) => allowLargeVideos && EVIDENCE_PATTERNS.videos.test(file));
  }
  return evidence;
}
export function collectExecutionArtifacts(root, { includeVideo = true } = {}) {
  return listFiles(root)
    .sort()
    .flatMap((file) => {
      const descriptor = EXECUTION_ARTIFACTS.find(({ pattern }) => pattern.test(file));
      if (!descriptor || (descriptor.kind === 'video' && !includeVideo)) return [];
      const extension = file.slice(file.lastIndexOf('.')).toLowerCase();
      const mimeType =
        descriptor.kind === 'log'
          ? LOG_MIME_TYPES[extension]
          : descriptor.kind === 'video'
            ? extension === '.mp4'
              ? 'video/mp4'
              : descriptor.mimeType
            : descriptor.kind === 'screenshot' && ['.jpg', '.jpeg'].includes(extension)
              ? 'image/jpeg'
              : descriptor.mimeType;
      if (!mimeType) return [];
      try {
        return [{ kind: descriptor.kind, filename: file, mimeType, content: readFileSync(join(root, file)) }];
      } catch {
        return [];
      }
    });
}
export function validateHostAllowlist(urls, allowedHosts) {
  const allowed = new Set(allowedHosts.map((host) => host.toLowerCase().replace(/\.$/, '')));
  const rejected = urls.filter((value) => {
    try {
      const target = new URL(value);
      if (!['http:', 'https:'].includes(target.protocol)) return true;
      const hostname = target.hostname.toLowerCase().replace(/\.$/, '');
      const localHostname =
        LOCAL_HOSTNAMES.has(hostname) || hostname.endsWith('.localhost') || hostname.endsWith('.local');
      if (localHostname || isUnsafeLiteralTarget(hostname)) return true;
      return !allowed.has(hostname);
    } catch {
      return true;
    }
  });
  return { allowed: rejected.length === 0, rejected };
}
export function normalizeEnvironmentTarget(value) {
  let target;
  try {
    target = new URL(String(value ?? ''));
  } catch {
    throw new Error('environment_url_invalid');
  }
  const host = target.hostname
    .toLowerCase()
    .replace(/^\[|\]$/g, '')
    .replace(/\.$/, '');
  if (
    !['http:', 'https:'].includes(target.protocol) ||
    target.username ||
    target.password ||
    !validateHostAllowlist([target.toString()], [host]).allowed
  ) {
    throw new Error('environment_target_rejected');
  }
  return { baseUrl: target.toString(), allowedHosts: [host] };
}
export function evaluateCompatibility({ feature, result, evidence, proof = {} }) {
  const errors = [...validateCanonicalFeature(feature).errors];
  if (result?.exitCode !== 0 || result?.result !== 'passed')
    errors.push('pass result must be observed with exit code 0');
  if (
    proof.exitSemantics?.pass?.exitCode !== 0 ||
    proof.exitSemantics?.pass?.result !== 'passed' ||
    typeof proof.exitSemantics?.fail?.exitCode !== 'number' ||
    proof.exitSemantics.fail.exitCode === 0 ||
    proof.exitSemantics?.fail?.result !== 'failed'
  )
    errors.push('pass/fail exit semantics proof is required');
  if (!proof.timeoutHardKill) errors.push('timeout hard-kill proof is required');
  if (
    proof.browserLimits?.headless !== HERCULES_CONTRACT.resourceLimits.browser.headless ||
    proof.browserLimits?.maxConcurrentPages !== HERCULES_CONTRACT.resourceLimits.browser.maxConcurrentPages
  )
    errors.push('browser limit proof is required');
  if (
    proof.llmLimits?.maxRequests !== HERCULES_CONTRACT.resourceLimits.llm.maxRequests ||
    proof.llmLimits?.maxTokens !== HERCULES_CONTRACT.resourceLimits.llm.maxTokens
  )
    errors.push('LLM limit proof is required');
  if (!proof.pathEnvironmentVerified) errors.push('path-environment proof is required');
  if (!proof.telemetryDisabled) errors.push('telemetry-disabled proof is required');
  if (!proof.hostAllowlistVerified) errors.push('host-allowlist proof is required');
  if (!proof.secretAbsenceVerified) errors.push('secret-absence proof is required');
  if (!proof.binaryEvidenceVerified) errors.push('binary-evidence proof is required');
  if (!proof.verificationSource) errors.push('verification source is required');
  if (evidence.missing.length) errors.push(`missing evidence: ${evidence.missing.join(', ')}`);
  if (!evidence.secretFree) errors.push('evidence contains secret material');
  if (evidence.binaryScan?.complete !== true) errors.push('binary evidence scan is incomplete');
  if (evidence.binaryScan?.suspiciousFiles?.length) errors.push('binary evidence contains secret material');
  return { ready: errors.length === 0, errors };
}

function diagnosticExecution(execution) {
  const value = execution && typeof execution === 'object' ? execution : {};
  const signal = typeof value.signal === 'string' && /^[A-Za-z0-9_-]{1,32}$/.test(value.signal) ? value.signal : null;
  const result = value.result === 'passed' || value.result === 'failed' ? value.result : undefined;
  return {
    exitCode: typeof value.exitCode === 'number' && Number.isFinite(value.exitCode) ? value.exitCode : null,
    ...(Object.prototype.hasOwnProperty.call(value, 'signal') ? { signal } : {}),
    ...(result ? { result } : {}),
    ...(typeof value.timedOut === 'boolean' ? { timedOut: value.timedOut } : {}),
  };
}

function diagnosticProof(proof) {
  const value = proof && typeof proof === 'object' ? proof : {};
  const proofResult = (candidate) => {
    if (!candidate || typeof candidate !== 'object') return null;
    return {
      exitCode:
        typeof candidate.exitCode === 'number' && Number.isFinite(candidate.exitCode) ? candidate.exitCode : null,
      result: candidate.result === 'passed' || candidate.result === 'failed' ? candidate.result : 'unknown',
    };
  };
  const source =
    typeof value.verificationSource === 'string' && /^[A-Za-z0-9._/-]{1,100}$/.test(value.verificationSource)
      ? value.verificationSource
      : undefined;
  return {
    exitSemantics: {
      pass: proofResult(value.exitSemantics?.pass),
      fail: proofResult(value.exitSemantics?.fail),
    },
    timeoutHardKill: value.timeoutHardKill === true,
    browserLimits: {
      headless: value.browserLimits?.headless === true,
      maxConcurrentPages: Number.isSafeInteger(value.browserLimits?.maxConcurrentPages)
        ? value.browserLimits.maxConcurrentPages
        : 0,
    },
    llmLimits: {
      maxRequests: Number.isSafeInteger(value.llmLimits?.maxRequests) ? value.llmLimits.maxRequests : 0,
      maxTokens: Number.isSafeInteger(value.llmLimits?.maxTokens) ? value.llmLimits.maxTokens : 0,
    },
    pathEnvironmentVerified: value.pathEnvironmentVerified === true,
    telemetryDisabled: value.telemetryDisabled === true,
    hostAllowlistVerified: value.hostAllowlistVerified === true,
    secretAbsenceVerified: value.secretAbsenceVerified === true,
    binaryEvidenceVerified: value.binaryEvidenceVerified === true,
    ...(source ? { verificationSource: source } : {}),
  };
}

/**
 * @param {{ workdir?: string, evidenceRoot?: string, feature?: string, allowedHosts?: string[], runner?: Function, runtimeEnv?: Record<string, string>, image?: string, workVolume?: string, volumeRoot?: string, proofFactory?: Function }} options
 */
export async function runCompatibilityGate({
  workdir,
  evidenceRoot = workdir,
  feature = CANONICAL_FEATURE,
  allowedHosts = [],
  runner,
  runtimeEnv = {},
  image,
  workVolume,
  volumeRoot,
  proofFactory,
} = {}) {
  const selectedVolume = workVolume === undefined ? undefined : resolveHerculesVolume(workVolume);
  if (!runner && process.env.UNITTCMS_HERCULES_COMPAT_REAL !== '1') {
    return { ready: false, skipped: true, reason: 'real Hercules compatibility execution is opt-in' };
  }
  const validation = validateCanonicalFeature(feature);
  const urls = [...String(feature).matchAll(/\b[a-z][a-z\d+.-]*:(?:\/\/)?[^\s"')]+/gi)].map(([url]) => url);
  const hosts = validateHostAllowlist(urls, allowedHosts);
  if (!validation.valid || !hosts.allowed)
    return {
      ready: false,
      skipped: false,
      errors: [...validation.errors, ...hosts.rejected.map((url) => `host is not allowlisted: ${url}`)],
    };
  const input = join(workdir, 'input', 'test.feature');
  mkdirSync(dirname(input), { recursive: true });
  mkdirSync(join(workdir, 'test-data'), { recursive: true });
  writeFileSync(input, feature, 'utf8');
  const pathEnvironment = buildHerculesPathEnvironment(workdir, selectedVolume, volumeRoot);
  const executionEnvironment = Object.freeze({ ...runtimeEnv, ...pathEnvironment });
  const invocation = buildHerculesInvocation(workdir, image, selectedVolume, {
    includeApiKey: shouldIncludeApiKey(runtimeEnv),
    volumeRoot,
  });
  const execution = await (runner
    ? runner(invocation, { env: executionEnvironment })
    : runHerculesProcess(invocation, { env: executionEnvironment }));
  const evidence = collectCompatibilityEvidence(evidenceRoot);
  let factoryOutput;
  if (proofFactory) {
    try {
      factoryOutput = await proofFactory({
        feature,
        allowedHosts,
        runtimeEnv: executionEnvironment,
        invocation,
        execution,
        evidence,
        evidenceRoot,
      });
    } catch {
      factoryOutput = undefined;
    }
  }
  const evaluated =
    factoryOutput &&
    Object.prototype.hasOwnProperty.call(factoryOutput, 'result') &&
    Object.prototype.hasOwnProperty.call(factoryOutput, 'proof')
      ? factoryOutput
      : { result: execution, proof: execution?.proof };
  return {
    ...evaluateCompatibility({ feature, result: evaluated.result, evidence, proof: evaluated.proof }),
    skipped: false,
    invocation,
    evidence,
    execution: diagnosticExecution(execution),
    proof: diagnosticProof(evaluated.proof),
  };
}
