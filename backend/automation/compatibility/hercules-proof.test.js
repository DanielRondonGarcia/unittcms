import { describe, expect, it } from 'vitest';
import { CANONICAL_FEATURE, HERCULES_CONTRACT, evaluateCompatibility } from './hercules.js';
import { HERCULES_PROOF_SOURCE, buildCompatibilityProof, parseCanonicalJUnit } from './hercules-proof.js';

const PASS_XML = '<testsuite tests="1" failures="0" errors="0"></testsuite>';
const FAIL_XML = '<testsuite tests="1" failures="1" errors="0"><failure>fixture failure</failure></testsuite>';
const invocation = [...HERCULES_CONTRACT.argv];
const keylessInvocation = [...invocation];
const apiKeyIndex = keylessInvocation.indexOf('LLM_MODEL_API_KEY');
keylessInvocation.splice(apiKeyIndex - 1, 2);
const runtimeEnv = {
  LLM_MODEL_NAME: 'fixture-model',
  LLM_MODEL_BASE_URL: 'https://llm.example.test/v1',
  LLM_MODEL_API_TYPE: 'openai',
  LLM_MODEL_API_KEY: 'fixture-key',
  LLM_MODEL_CLIENT_HOST: 'https://llm.example.test/v1',
  PROJECT_SOURCE_ROOT: '/testzeus-hercules/opt',
  INPUT_GHERKIN_FILE_PATH: '/testzeus-hercules/opt/input/test.feature',
  JUNIT_XML_BASE_PATH: '/testzeus-hercules/opt/output',
  TEST_DATA_PATH: '/testzeus-hercules/opt/test-data',
};
const cloudKey = 'fixture-cloud-key';
const cloudRuntimeEnv = {
  LLM_MODEL_NAME: 'cloud-model',
  LLM_MODEL_BASE_URL: 'https://ollama.com/api',
  LLM_MODEL_API_TYPE: 'ollama',
  LLM_MODEL_API_KEY: cloudKey,
  LLM_MODEL_CLIENT_HOST: 'https://ollama.com/api',
  PROJECT_SOURCE_ROOT: '/testzeus-hercules/opt',
  INPUT_GHERKIN_FILE_PATH: '/testzeus-hercules/opt/input/test.feature',
  JUNIT_XML_BASE_PATH: '/testzeus-hercules/opt/output',
  TEST_DATA_PATH: '/testzeus-hercules/opt/test-data',
};
const evidence = {
  missing: [],
  secretFree: true,
  binaryScan: { complete: true, scannedFiles: ['proof.png'], suspiciousFiles: [], unscannedFiles: [] },
};

function context(overrides = {}) {
  return {
    passResult: parseCanonicalJUnit(PASS_XML, 0),
    failureProbe: { exitCode: 1, result: 'failed' },
    timeoutProbe: { errorCode: 'ETIMEDOUT', killInvoked: true },
    invocation,
    runtimeEnv,
    feature: CANONICAL_FEATURE,
    allowedHosts: ['example.com'],
    evidence,
    ...overrides,
  };
}

function evaluate(built, collectedEvidence = evidence) {
  return evaluateCompatibility({
    feature: CANONICAL_FEATURE,
    result: built.result,
    evidence: collectedEvidence,
    proof: built.proof,
  });
}

describe('Hercules compatibility proof harness', () => {
  it('parses only a zero-failure, zero-error pass with exit code zero', () => {
    expect(parseCanonicalJUnit(PASS_XML, 0)).toEqual({ exitCode: 0, result: 'passed' });
    expect(parseCanonicalJUnit(FAIL_XML, 0)).toBeNull();
    expect(parseCanonicalJUnit(PASS_XML, 1)).toBeNull();
  });

  it('builds proof from all observed checks', () => {
    const built = buildCompatibilityProof(context());

    expect(built.result).toEqual({ exitCode: 0, result: 'passed' });
    expect(built.proof).toEqual({
      exitSemantics: { pass: { exitCode: 0, result: 'passed' }, fail: { exitCode: 1, result: 'failed' } },
      timeoutHardKill: true,
      browserLimits: { headless: true, maxConcurrentPages: 1 },
      llmLimits: { maxRequests: 10, maxTokens: 4096 },
      pathEnvironmentVerified: true,
      telemetryDisabled: true,
      hostAllowlistVerified: true,
      secretAbsenceVerified: true,
      binaryEvidenceVerified: true,
      verificationSource: HERCULES_PROOF_SOURCE,
    });
    expect(evaluate(built).ready).toBe(true);
  });

  it('accepts keyless Ollama runtime evidence but rejects an unrelated key', () => {
    const keyless = buildCompatibilityProof(
      context({
        invocation: keylessInvocation,
        runtimeEnv: {
          ...runtimeEnv,
          LLM_MODEL_API_TYPE: 'ollama',
          LLM_MODEL_API_KEY: undefined,
        },
      })
    );
    expect(keyless.proof.llmLimits).toEqual({ maxRequests: 10, maxTokens: 4096 });
    expect(evaluate(keyless).ready).toBe(true);

    const unrelated = buildCompatibilityProof(
      context({
        runtimeEnv: { ...runtimeEnv, LLM_MODEL_API_TYPE: 'ollama' },
      })
    );
    expect(unrelated.proof.llmLimits).toEqual({ maxRequests: 0, maxTokens: 0 });
    expect(evaluate(unrelated).ready).toBe(false);
  });

  it('accepts authenticated direct Ollama Cloud only with the key marker and safe endpoint', () => {
    const cloud = buildCompatibilityProof(
      context({
        runtimeEnv: cloudRuntimeEnv,
      })
    );

    expect(cloud.proof.llmLimits).toEqual({ maxRequests: 10, maxTokens: 4096 });
    expect(evaluate(cloud).ready).toBe(true);
    expect(JSON.stringify(cloud)).not.toContain(cloudKey);

    const missingKey = buildCompatibilityProof(
      context({
        invocation: keylessInvocation,
        runtimeEnv: { ...cloudRuntimeEnv, LLM_MODEL_API_KEY: undefined },
      })
    );
    expect(missingKey.proof.llmLimits).toEqual({ maxRequests: 0, maxTokens: 0 });
    expect(evaluate(missingKey).ready).toBe(false);
  });

  it('fails closed for a failing JUnit document or wrong failure-probe exit code', () => {
    expect(evaluate(buildCompatibilityProof(context({ passResult: parseCanonicalJUnit(FAIL_XML, 0) }))).ready).toBe(
      false
    );
    expect(evaluate(buildCompatibilityProof(context({ failureProbe: { exitCode: 2, result: 'failed' } }))).ready).toBe(
      false
    );
  });

  it('fails closed when evidence is missing or contains secret material', () => {
    const unsafeEvidence = {
      missing: ['junit'],
      secretFree: false,
      binaryScan: { complete: true, scannedFiles: [], suspiciousFiles: ['proof.png'], unscannedFiles: [] },
    };
    const built = buildCompatibilityProof(
      context({
        evidence: unsafeEvidence,
      })
    );

    expect(built.proof.secretAbsenceVerified).toBe(false);
    expect(built.proof.binaryEvidenceVerified).toBe(false);
    expect(evaluate(built, unsafeEvidence).ready).toBe(false);
  });

  it('fails closed when fixed browser invocation environment is changed', () => {
    const badInvocation = invocation.map((value) => (value === 'HEADLESS=true' ? 'HEADLESS=false' : value));
    const built = buildCompatibilityProof(context({ invocation: badInvocation }));

    expect(built.proof.browserLimits).toEqual({ headless: false, maxConcurrentPages: 0 });
    expect(evaluate(built).ready).toBe(false);
  });

  it('fails closed when a per-run path is missing from the process environment', () => {
    const built = buildCompatibilityProof(
      context({
        runtimeEnv: { ...runtimeEnv, TEST_DATA_PATH: undefined },
      })
    );

    expect(built.proof.pathEnvironmentVerified).toBe(false);
    expect(evaluate(built).ready).toBe(false);
  });

  it('fails closed when timeout proof lacks observed kill', () => {
    const built = buildCompatibilityProof(context({ timeoutProbe: { errorCode: 'ETIMEDOUT', killInvoked: false } }));

    expect(built.proof.timeoutHardKill).toBe(false);
    expect(evaluate(built).ready).toBe(false);
  });
});
