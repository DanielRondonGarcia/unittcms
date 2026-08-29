import { EventEmitter } from 'node:events';
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import * as hercules from './hercules.js';
const proof = {
  exitSemantics: { pass: { exitCode: 0, result: 'passed' }, fail: { exitCode: 1, result: 'failed' } },
  timeoutHardKill: true,
  browserLimits: { headless: true, maxConcurrentPages: 1 },
  llmLimits: { maxRequests: 10, maxTokens: 4096 },
  pathEnvironmentVerified: true,
  telemetryDisabled: true,
  hostAllowlistVerified: true,
  secretAbsenceVerified: true,
  binaryEvidenceVerified: true,
  verificationSource: 'isolated-ci',
};
const roots = [];
afterEach(() => roots.splice(0).forEach((root) => rmSync(root, { recursive: true, force: true })));
function makeRoot() {
  const root = mkdtempSync(join(tmpdir(), 'unittcms-hercules-'));
  roots.push(root);
  return root;
}
function writeEvidence(root, secret) {
  const files = [
    'output/test.feature_result.xml',
    'output/test.feature_result.html',
    'proofs/Scenario/run_1/screenshots/step.png',
    'proofs/Scenario/run_1/videos/step.webm',
    'proofs/Scenario/run_1/network_logs.json',
    'log_files/Scenario/run_1/events.log',
    'log_files/Scenario/run_1/agent_inner_thoughts.json',
  ];
  files.forEach((file) => {
    mkdirSync(dirname(join(root, file)), { recursive: true });
    writeFileSync(join(root, file), secret && file.endsWith('.log') ? secret : 'safe fixture');
  });
}
const childProcess = (pid = 41) => Object.assign(new EventEmitter(), { pid });
describe('Hercules compatibility contract', () => {
  it('pins the release, digest, English feature, and fixed container argv', () => {
    const root = makeRoot();
    const invocation = hercules.buildHerculesInvocation(root);
    expect(hercules.HERCULES_CONTRACT.image).toBe(
      'testzeus/hercules:0.1.2@sha256:11ff3700104f92230bafdff1e85f43b8932e8a7df5ab85b7f7d00d3cea61f52c'
    );
    expect(hercules.validateCanonicalFeature(hercules.CANONICAL_FEATURE).valid).toBe(true);
    expect(
      hercules.validateCanonicalFeature(
        'Feature: Outline\n  Scenario Outline: Login\n    Given a user\n    When they sign in\n    Then they see the dashboard'
      ).valid
    ).toBe(true);
    expect(
      hercules.validateCanonicalFeature(
        'Feature: Localized\n  Scenario: Caso\n    Dado algo\n    Cuando algo\n    Entonces algo'
      ).valid
    ).toBe(false);
    expect(invocation.argv).toEqual([
      ...hercules.HERCULES_CONTRACT.argv,
      '--mount',
      `type=bind,src=${root},dst=/testzeus-hercules/opt`,
      hercules.HERCULES_CONTRACT.image,
    ]);
    expect(invocation.argv).toContain('RECORD_VIDEO=false');
    expect(hercules.buildHerculesInvocation(root, undefined, undefined, { captureVideo: true }).argv).toContain(
      'RECORD_VIDEO=true'
    );
    expect(invocation.argv).toEqual(
      expect.arrayContaining([
        '--env',
        'LLM_MODEL_NAME',
        '--env',
        'LLM_MODEL_API_KEY',
        '--env',
        'LLM_MODEL_BASE_URL',
        '--env',
        'LLM_MODEL_CLIENT_HOST',
        '--env',
        'LLM_MODEL_API_TYPE',
        '--env',
        'HERCULES_BASE_URL',
        '--env',
        'HERCULES_ALLOWED_HOSTS',
        '--env',
        'PROJECT_SOURCE_ROOT',
        '--env',
        'INPUT_GHERKIN_FILE_PATH',
        '--env',
        'JUNIT_XML_BASE_PATH',
        '--env',
        'TEST_DATA_PATH',
      ])
    );
    expect(invocation.argv).not.toContain('--input-file');
    expect(invocation.argv).not.toContain('--output-path');
    expect(invocation.argv).not.toContain('--test-data-path');
    expect(invocation.argv).not.toContain('--project-base');
    expect(invocation.argv).not.toContain('HERCULES_LLM_PROVIDER');
    expect(invocation.argv).not.toContain('HERCULES_LLM_MODEL');
    expect(invocation.argv).not.toContain('LITELLM_BASE_URL');
    expect(invocation.argv).not.toContain('LITELLM_API_KEY');
    expect(hercules.buildHerculesInvocation(root, '').argv).toContain(hercules.HERCULES_CONTRACT.image);
    const localImage = 'testzeus/hercules:0.1.2-amd64';
    expect(hercules.buildHerculesInvocation(root, localImage).argv).toEqual(expect.arrayContaining([localImage]));
  });
  it('uses the supplied named volume instead of a host bind mount', () => {
    const root = makeRoot();
    const workspace = join(root, 'run-123');
    const volume = 'unittcms_hercules-work';
    const invocation = hercules.buildHerculesInvocation(workspace, undefined, volume, { volumeRoot: root });

    expect(invocation.argv).toEqual([
      ...hercules.HERCULES_CONTRACT.argv,
      '--mount',
      `type=volume,src=${volume},dst=/testzeus-hercules/opt`,
      hercules.HERCULES_CONTRACT.image,
    ]);
    expect(invocation.argv.join(' ')).not.toContain(root);
    expect(hercules.buildHerculesPathEnvironment(workspace, volume, root)).toEqual({
      PROJECT_SOURCE_ROOT: '/testzeus-hercules/opt/run-123',
      INPUT_GHERKIN_FILE_PATH: '/testzeus-hercules/opt/run-123/input/test.feature',
      JUNIT_XML_BASE_PATH: '/testzeus-hercules/opt/run-123/output',
      TEST_DATA_PATH: '/testzeus-hercules/opt/run-123/test-data',
    });
  });
  it('rejects a named-volume workspace outside the configured worker workdir', () => {
    const root = makeRoot();
    expect(() =>
      hercules.buildHerculesInvocation(join(root, 'run-123'), undefined, 'unittcms_hercules-work', {
        volumeRoot: join(root, 'other'),
      })
    ).toThrow('hercules_workspace_invalid');
  });
  it('omits the inherited API key marker for local Ollama but keeps it for Cloud', async () => {
    const localRoot = makeRoot();
    let localInvocation;
    await hercules.runCompatibilityGate({
      workdir: localRoot,
      evidenceRoot: localRoot,
      feature: hercules.CANONICAL_FEATURE,
      allowedHosts: ['example.com'],
      runtimeEnv: {
        LLM_MODEL_NAME: 'local-model',
        LLM_MODEL_BASE_URL: 'http://host.docker.internal:11434',
        LLM_MODEL_CLIENT_HOST: 'http://host.docker.internal:11434',
        LLM_MODEL_API_TYPE: 'ollama',
      },
      runner: async (invocation) => {
        localInvocation = invocation;
        writeEvidence(localRoot);
        return { exitCode: 0 };
      },
    });

    const cloudRoot = makeRoot();
    let cloudInvocation;
    const cloudKey = 'fixture-cloud-key';
    await hercules.runCompatibilityGate({
      workdir: cloudRoot,
      evidenceRoot: cloudRoot,
      feature: hercules.CANONICAL_FEATURE,
      allowedHosts: ['example.com'],
      runtimeEnv: {
        LLM_MODEL_NAME: 'cloud-model',
        LLM_MODEL_BASE_URL: 'https://ollama.com/api',
        LLM_MODEL_CLIENT_HOST: 'https://ollama.com/api',
        LLM_MODEL_API_TYPE: 'ollama',
        LLM_MODEL_API_KEY: cloudKey,
      },
      runner: async (invocation) => {
        cloudInvocation = invocation;
        writeEvidence(cloudRoot);
        return { exitCode: 0 };
      },
    });

    expect(localInvocation.argv).not.toContain('LLM_MODEL_API_KEY');
    expect(cloudInvocation.argv).toContain('LLM_MODEL_API_KEY');
    expect(cloudInvocation.argv.join(' ')).not.toContain(cloudKey);
  });
  it('collects required evidence and fails closed for missing proof or secrets', () => {
    const root = makeRoot();
    writeEvidence(root);
    const evidence = hercules.collectCompatibilityEvidence(root);
    const ready = hercules.evaluateCompatibility({
      feature: hercules.CANONICAL_FEATURE,
      result: { exitCode: 0, result: 'passed' },
      evidence,
      proof,
    });
    expect(evidence.missing).toEqual([]);
    expect(ready.ready).toBe(true);
    const invalidProof = {
      ...proof,
      exitSemantics: { ...proof.exitSemantics, fail: { exitCode: 0, result: 'failed' } },
    };
    expect(
      hercules.evaluateCompatibility({
        feature: hercules.CANONICAL_FEATURE,
        result: { exitCode: 0, result: 'passed' },
        evidence,
        proof: invalidProof,
      }).ready
    ).toBe(false);
    writeEvidence(root, ['password', 'fixture-secret-value'].join('='));
    const unsafe = hercules.collectCompatibilityEvidence(root);
    expect(
      hercules.evaluateCompatibility({
        feature: hercules.CANONICAL_FEATURE,
        result: { exitCode: 0, result: 'passed' },
        evidence: unsafe,
        proof,
      }).ready
    ).toBe(false);
    expect(
      hercules.evaluateCompatibility({
        feature: hercules.CANONICAL_FEATURE,
        result: { exitCode: 0, result: 'passed' },
        evidence,
      }).ready
    ).toBe(false);
    expect(hercules.validateHostAllowlist(['https://example.test/login'], ['example.test']).allowed).toBe(true);
    expect(hercules.validateHostAllowlist(['https://evil.test/login'], ['example.test']).allowed).toBe(false);
  });
  it('runs a safe stub by default and never claims readiness without proof', async () => {
    const root = makeRoot();
    const skipped = await hercules.runCompatibilityGate({ workdir: root, evidenceRoot: root });
    expect(skipped).toMatchObject({ ready: false, skipped: true });

    const workspace = join(root, 'run-compatibility');
    const result = await hercules.runCompatibilityGate({
      workdir: workspace,
      evidenceRoot: workspace,
      feature: hercules.CANONICAL_FEATURE,
      allowedHosts: ['example.com'],
      image: 'testzeus/hercules:0.1.2-amd64',
      workVolume: 'unittcms_hercules-work',
      volumeRoot: root,
      runner: async (invocation, options) => {
        writeEvidence(workspace);
        expect(invocation.argv).toContain('type=volume,src=unittcms_hercules-work,dst=/testzeus-hercules/opt');
        expect(existsSync(join(workspace, 'test-data'))).toBe(true);
        expect(options.env).toMatchObject({
          PROJECT_SOURCE_ROOT: '/testzeus-hercules/opt/run-compatibility',
          INPUT_GHERKIN_FILE_PATH: '/testzeus-hercules/opt/run-compatibility/input/test.feature',
          JUNIT_XML_BASE_PATH: '/testzeus-hercules/opt/run-compatibility/output',
          TEST_DATA_PATH: '/testzeus-hercules/opt/run-compatibility/test-data',
        });
        return { exitCode: 0, result: 'passed' };
      },
    });
    expect(result.ready).toBe(false);
    expect(result.errors).toContain('pass/fail exit semantics proof is required');
    expect(result.invocation.argv).toContain('testzeus/hercules:0.1.2-amd64');
  });
  it.each(['', 'has space', 'has/slash', 'has\\slash', 'has\u0000control', '.hidden', '-leading', 'a'.repeat(256)])(
    'rejects unsafe Hercules volume overrides: %s',
    (volume) => {
      expect(() => hercules.buildHerculesInvocation(makeRoot(), undefined, volume)).toThrow('hercules_volume_invalid');
    }
  );
  it.each(['local image:latest', 'local/hercules;touch', '--privileged'])(
    'rejects unsafe image overrides: %s',
    (image) => {
      expect(() => hercules.buildHerculesInvocation(makeRoot(), image)).toThrow('hercules_image_invalid');
    }
  );
  it('scans binary evidence bytes and requires a binary secret proof', () => {
    const root = makeRoot();
    writeEvidence(root);
    const binaryPath = 'proofs/Scenario/run_1/screenshots/step.png';
    const secret = 'Authorization: Bearer binary-secret-token';
    writeFileSync(join(root, binaryPath), Buffer.concat([Buffer.from([0, 255, 1]), Buffer.from(secret)]));

    const evidence = hercules.collectCompatibilityEvidence(root);
    expect(evidence.binaryFiles).toContain(binaryPath);
    expect(evidence.binaryScan).toMatchObject({ complete: true, suspiciousFiles: [binaryPath] });
    expect(evidence.secretFree).toBe(false);
    expect(JSON.stringify(evidence)).not.toContain(secret);
    expect(
      hercules.evaluateCompatibility({
        feature: hercules.CANONICAL_FEATURE,
        result: { exitCode: 0, result: 'passed' },
        evidence: { ...evidence, secretFree: true, binaryScan: { ...evidence.binaryScan, suspiciousFiles: [] } },
        proof: { ...proof, binaryEvidenceVerified: false },
      }).ready
    ).toBe(false);
  });
  it('returns allowlisted execution artifacts with their original bytes before cleanup', () => {
    const root = makeRoot();
    writeEvidence(root);

    const artifacts = hercules.collectExecutionArtifacts(root);

    expect(artifacts.map(({ kind }) => kind)).toEqual([
      'planner',
      'log',
      'html',
      'junit',
      'network',
      'screenshot',
      'video',
    ]);
    expect(artifacts.find(({ kind }) => kind === 'video')).toMatchObject({
      filename: 'proofs/Scenario/run_1/videos/step.webm',
      mimeType: 'video/webm',
      content: Buffer.from('safe fixture'),
    });
  });
  it('derives log MIME types from recognized extensions and excludes unknown extensions', () => {
    const root = makeRoot();
    const files = [
      ['log_files/Scenario/run_1/events.json', 'application/json'],
      ['log_files/Scenario/run_1/events.log', 'text/plain'],
      ['log_files/Scenario/run_1/events.txt', 'text/plain'],
    ];
    files.forEach(([file]) => {
      mkdirSync(dirname(join(root, file)), { recursive: true });
      writeFileSync(join(root, file), '{}');
    });
    const unknownFile = 'log_files/Scenario/run_1/events.yaml';
    writeFileSync(join(root, unknownFile), '{}');

    const artifacts = hercules.collectExecutionArtifacts(root);

    expect(artifacts.map(({ filename, mimeType }) => ({ filename, mimeType }))).toEqual(
      files.map(([filename, mimeType]) => ({ filename, mimeType }))
    );
    expect(artifacts.some(({ filename }) => filename === unknownFile)).toBe(false);
  });
  it('fails closed when a binary artifact exceeds the bounded scan window', () => {
    const root = makeRoot();
    writeEvidence(root);
    const binaryPath = 'proofs/Scenario/run_1/videos/large.webm';
    writeFileSync(join(root, binaryPath), Buffer.alloc(1024 * 1024 + 1, 0));

    const evidence = hercules.collectCompatibilityEvidence(root);

    expect(evidence.binaryScan).toMatchObject({ complete: false, unscannedFiles: [binaryPath] });
    expect(evidence.secretFree).toBe(false);

    const executionEvidence = hercules.collectCompatibilityEvidence(root, { allowLargeVideos: true });
    expect(executionEvidence.binaryScan).toMatchObject({ complete: false, unscannedFiles: [binaryPath] });
    expect(executionEvidence.executionSafe).toBe(true);
    expect(
      hercules.evaluateCompatibility({
        feature: hercules.CANONICAL_FEATURE,
        result: { exitCode: 0, result: 'passed' },
        evidence: executionEvidence,
        proof,
      }).ready
    ).toBe(false);
  });
  it('keeps unknown large binaries unsafe for execution artifact collection', () => {
    const root = makeRoot();
    writeEvidence(root);
    const unknownPath = 'unknown.bin';
    writeFileSync(join(root, unknownPath), Buffer.alloc(1024 * 1024 + 1, 0));

    const evidence = hercules.collectCompatibilityEvidence(root, { allowLargeVideos: true });

    expect(evidence.executionSafe).toBe(false);
    expect(evidence.binaryScan.unscannedFiles).toContain(unknownPath);
  });
  it.each([
    ['non-HTTP protocol', 'ftp://example.test/resource', 'example.test'],
    ['localhost', 'http://localhost/resource', 'localhost'],
    ['local hostname', 'http://dev.local/resource', 'dev.local'],
    ['loopback IPv4', 'http://127.0.0.1/resource', '127.0.0.1'],
    ['RFC1918 private IPv4 (10/8)', 'http://10.0.0.10/resource', '10.0.0.10'],
    ['RFC1918 private IPv4 (172.16/12)', 'http://172.16.0.10/resource', '172.16.0.10'],
    ['RFC1918 private IPv4 (192.168/16)', 'http://192.168.1.10/resource', '192.168.1.10'],
    ['link-local IPv4', 'http://169.254.1.10/resource', '169.254.1.10'],
    ['metadata IPv4', 'http://169.254.169.254/latest/meta-data', '169.254.169.254'],
    ['loopback IPv6', 'http://[::1]/resource', '[::1]'],
    ['private IPv6', 'http://[fd00::10]/resource', '[fd00::10]'],
  ])('rejects %s targets even when their host is allowlisted', (_label, url, allowedHost) => {
    expect(hercules.validateHostAllowlist([url], [allowedHost])).toEqual({ allowed: false, rejected: [url] });
  });
  it('normalizes the base host and preserves additional exact hosts', () => {
    expect(
      hercules.normalizeEnvironmentTarget('https://APP.example.test/app', [
        ' https://Gateway.Example.Test/ ',
        'app.example.test',
      ])
    ).toEqual({
      baseUrl: 'https://app.example.test/app',
      allowedHosts: ['app.example.test', 'gateway.example.test'],
    });
  });
  it.each([
    'gateway.example.test/path',
    'gateway.example.test:80',
    'gateway.example.test:443',
    '*.example.test',
    'localhost',
    'gateway.example.test\u0000',
    'not a hostname',
  ])('rejects unsafe additional host entries: %s', (host) => {
    expect(() => hercules.normalizeEnvironmentTarget('https://app.example.test', [host])).toThrow();
  });
  it.each([
    'https://gateway.example.test/path',
    'https://gateway.example.test:80',
    'https://gateway.example.test:443',
    'https://gateway.example.test:8443/',
    'https://gateway.example.test?next=/login',
    'https://gateway.example.test#login',
    'https://user:password@gateway.example.test/',
    'ftp://gateway.example.test/',
  ])('rejects non-origin additional URL entries: %s', (value) => {
    expect(() => hercules.normalizeEnvironmentTarget('https://app.example.test', [value])).toThrow(
      'environment_host_invalid'
    );
  });
  it.each([
    ['https://gateway.example.test', 'gateway.example.test'],
    ['http://gateway.example.test/', 'gateway.example.test'],
    ['HTTPS://Gateway.Example.Test/', 'gateway.example.test'],
  ])('canonicalizes an additional origin to its exact host: %s', (value, host) => {
    expect(hercules.normalizeEnvironmentTarget('https://app.example.test', [value])).toMatchObject({
      allowedHosts: ['app.example.test', host],
    });
  });
  it.each(['http://app.example.test:80', 'https://app.example.test:443', 'https://app.example.test:8443'])(
    'rejects an explicit base URL port: %s',
    (value) => {
      expect(() => hercules.normalizeEnvironmentTarget(value)).toThrow('environment_target_rejected');
    }
  );
  it('allows a public IPv6 literal without an explicit port', () => {
    expect(hercules.normalizeEnvironmentTarget('https://[2001:db8::10]/app')).toEqual({
      baseUrl: 'https://[2001:db8::10]/app',
      allowedHosts: ['2001:db8::10'],
    });
    expect(() => hercules.normalizeEnvironmentTarget('https://[2001:db8::10]:443/app')).toThrow(
      'environment_target_rejected'
    );
  });
  it.each([
    'https://gateway.example.test:80/login',
    'https://gateway.example.test:443/login',
    'https://gateway.example.test:8443/login',
  ])('rejects explicit ports during allowlist validation: %s', (value) => {
    expect(hercules.validateHostAllowlist([value], ['gateway.example.test'])).toEqual({
      allowed: false,
      rejected: [value],
    });
  });
  it('rejects a malformed host list without exposing its values', () => {
    expect(() => hercules.normalizeEnvironmentTarget('https://app.example.test', 'gateway.example.test')).toThrow(
      'environment_hosts_invalid'
    );
    expect(() =>
      hercules.normalizeEnvironmentTarget('https://app.example.test', ['https://secret.example.test/path'])
    ).toThrow('environment_host_invalid');
  });
});
describe('Hercules process boundary', () => {
  it('uses fixed argv without shell interpolation', async () => {
    const root = makeRoot();
    const invocation = hercules.buildHerculesInvocation(join(root, 'safe; touch forbidden'));
    const child = childProcess();
    const spawnImpl = vi.fn(() => {
      queueMicrotask(() => child.emit('close', 0, null));
      return child;
    });

    await expect(hercules.runHerculesProcess(invocation, { spawnImpl })).resolves.toMatchObject({ exitCode: 0 });
    expect(spawnImpl).toHaveBeenCalledWith(
      'docker',
      invocation.argv,
      expect.objectContaining({ shell: false, detached: true })
    );
  });
  it('forwards only explicitly injected runtime variables to the isolated process', async () => {
    const invocation = hercules.buildHerculesInvocation(makeRoot());
    const child = childProcess();
    const spawnImpl = vi.fn((_file, _argv, options) => {
      expect(options.env).toEqual({ PATH: expect.any(String), LLM_MODEL_BASE_URL: 'https://llm.example.test' });
      queueMicrotask(() => child.emit('close', 0, null));
      return child;
    });

    await expect(
      hercules.runHerculesProcess(invocation, {
        spawnImpl,
        env: { LLM_MODEL_BASE_URL: 'https://llm.example.test' },
      })
    ).resolves.toMatchObject({ exitCode: 0 });
  });
  it('kills the process group on timeout', async () => {
    const invocation = hercules.buildHerculesInvocation(makeRoot());
    const child = childProcess(73);
    const spawnImpl = vi.fn(() => child);
    const killProcessGroup = vi.fn();

    await expect(
      hercules.runHerculesProcess(invocation, { spawnImpl, timeoutMs: 5, killProcessGroup })
    ).rejects.toMatchObject({
      code: 'ETIMEDOUT',
    });
    expect(killProcessGroup).toHaveBeenCalledWith(-73, 'SIGKILL');
  });
  it('uses shell-free taskkill for the default Windows timeout terminator', async () => {
    const invocation = hercules.buildHerculesInvocation(makeRoot());
    const child = childProcess(73);
    const execFileImpl = vi.fn((_file, _args, _options, callback) => callback(new Error('ESRCH')));

    await expect(
      hercules.runHerculesProcess(invocation, {
        spawnImpl: vi.fn(() => child),
        timeoutMs: 5,
        platform: 'win32',
        execFileImpl,
      })
    ).rejects.toMatchObject({ code: 'ETIMEDOUT' });
    expect(execFileImpl).toHaveBeenCalledWith(
      'taskkill',
      ['/PID', '73', '/T', '/F'],
      { shell: false, windowsHide: true },
      expect.any(Function)
    );
  });
  it('rejects with a timeout when termination reports an exited process', async () => {
    const invocation = hercules.buildHerculesInvocation(makeRoot());
    const killProcessGroup = vi.fn(() => {
      throw Object.assign(new Error('ESRCH'), { code: 'ESRCH' });
    });

    await expect(
      hercules.runHerculesProcess(invocation, {
        spawnImpl: vi.fn(() => childProcess(73)),
        timeoutMs: 5,
        killProcessGroup,
      })
    ).rejects.toMatchObject({ code: 'ETIMEDOUT' });
  });
});
