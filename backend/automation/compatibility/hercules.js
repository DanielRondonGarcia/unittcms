import { spawn as defaultSpawn } from 'node:child_process';
import { mkdirSync, readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { isIP } from 'node:net';
import { dirname, join, relative, resolve } from 'node:path';
const HERCULES_IMAGE =
  'testzeus/hercules:0.1.2@sha256:11ff3700104f92230bafdff1e85f43b8932e8a7df5ab85b7f7d00d3cea61f52c';
const FIXED_DOCKER_ARGS =
  'run --rm --init --cpus=2 --memory=4g --pids-limit=256 --env AUTO_MODE=1 --env ENABLE_TELEMETRY=0 --env HEADLESS=true --env BROWSER_TYPE=chromium --env RECORD_VIDEO=true --env TAKE_SCREENSHOTS=true --env CAPTURE_NETWORK=true'.split(
    ' '
  );
const EVIDENCE_PATTERNS = {
  junit: /^output\/[^/]+\.xml$/i,
  html: /^output\/[^/]+\.html$/i,
  screenshots: /^proofs\/[^/]+\/run_[^/]+\/screenshots\/.+\.(?:png|jpe?g)$/i,
  videos: /^proofs\/[^/]+\/run_[^/]+\/videos\/.+\.(?:webm|mp4)$/i,
  logs: /^log_files\/.+/i,
  network: /^proofs\/[^/]+\/run_[^/]+\/network_logs\.json$/i,
  planner: /^log_files\/[^/]+\/run_[^/]+\/agent_inner_thoughts\.json$/i,
};
const TEXT_EVIDENCE = /\.(?:xml|html|json|log|txt)$/i;
const MAX_BINARY_SCAN_BYTES = 1024 * 1024;
const LOCAL_HOSTNAMES = new Set(['local', 'localhost', 'localhost.localdomain', 'ip6-localhost', 'ip6-loopback']);
export const HERCULES_CONTRACT = Object.freeze({
  release: '0.1.2',
  image: HERCULES_IMAGE,
  argv: Object.freeze(FIXED_DOCKER_ARGS),
  timeoutMs: 120_000,
  resourceLimits: Object.freeze({
    container: Object.freeze({ cpus: 2, memory: '4g', pids: 256 }),
    browser: Object.freeze({ headless: true, maxConcurrentPages: 1 }),
    llm: Object.freeze({ maxRequests: 10, maxTokens: 4096 }),
  }),
});
export const CANONICAL_FEATURE = `Feature: UnitTCMS compatibility

  Scenario: Open the allowed test page
    Given I open the page "https://example.test"
    When I inspect the page
    Then the page is available
`;
export function validateCanonicalFeature(feature) {
  const text = String(feature ?? '');
  const steps = [...text.matchAll(/^\s*(Given|When|Then|And|But)\b/gm)].map((match) => match[1]);
  const localized = /\b(?:Dado|Cuando|Entonces|Y|Pero)\b/i.test(text);
  const valid =
    /^\s*Feature:\s*\S+/m.test(text) &&
    /^\s*Scenario:\s*\S+/m.test(text) &&
    !localized &&
    ['Given', 'When', 'Then'].every((keyword) => steps.includes(keyword));
  return {
    valid,
    errors: valid ? [] : ['feature must contain English Feature, Scenario, Given, When, and Then keywords'],
  };
}
export function buildHerculesInvocation(workdir) {
  const cwd = resolve(workdir);
  if (/[\r\n,]/.test(cwd)) {
    throw new Error('compatibility workspace path contains unsafe mount characters');
  }
  return {
    file: 'docker',
    cwd,
    argv: [...FIXED_DOCKER_ARGS, '--mount', `type=bind,src=${cwd},dst=/testzeus-hercules/opt`, HERCULES_IMAGE],
  };
}
export function runHerculesProcess(
  invocation,
  {
    spawnImpl = defaultSpawn,
    timeoutMs = HERCULES_CONTRACT.timeoutMs,
    killProcessGroup = (pid, signal) => process.kill(pid, signal),
    env: runtimeEnv = {},
  } = {}
) {
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
        if (child.pid) killProcessGroup(-child.pid, 'SIGKILL');
      } finally {
        const error = new Error(`Hercules compatibility process exceeded ${timeoutMs}ms`);
        error.code = 'ETIMEDOUT';
        finish(reject, error);
      }
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
function containsSecretBytes(bytes) {
  return containsSecretMaterial(Buffer.from(bytes).toString('latin1'));
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
export function collectCompatibilityEvidence(root) {
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
    if (containsSecretBytes(readFileSync(path))) binaryScan.suspiciousFiles.push(file);
  }
  return {
    files,
    missing,
    textFiles,
    binaryFiles,
    binaryScan,
    secretFree: !containsSecretMaterial(text) && binaryScan.complete && binaryScan.suspiciousFiles.length === 0,
  };
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
/**
 * @param {{ workdir?: string, evidenceRoot?: string, feature?: string, allowedHosts?: string[], runner?: Function, runtimeEnv?: Record<string, string> }} options
 */
export async function runCompatibilityGate({
  workdir,
  evidenceRoot = workdir,
  feature = CANONICAL_FEATURE,
  allowedHosts = [],
  runner,
  runtimeEnv = {},
} = {}) {
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
  writeFileSync(input, feature, 'utf8');
  const invocation = buildHerculesInvocation(workdir);
  const execution = await (runner ? runner(invocation) : runHerculesProcess(invocation, { env: runtimeEnv }));
  const evidence = collectCompatibilityEvidence(evidenceRoot);
  return {
    ...evaluateCompatibility({ feature, result: execution, evidence, proof: execution.proof }),
    skipped: false,
    invocation,
    evidence,
  };
}
