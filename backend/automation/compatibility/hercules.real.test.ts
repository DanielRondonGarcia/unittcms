import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { CANONICAL_FEATURE, HERCULES_CONTRACT, runCompatibilityGate } from './hercules.js';
import { createCompatibilityProof } from './hercules-proof.js';

const runReal = process.env.UNITTCMS_HERCULES_COMPAT_REAL === '1';
const describeReal = runReal ? describe : describe.skip;
const roots: string[] = [];

afterEach(() => roots.splice(0).forEach((root) => rmSync(root, { recursive: true, force: true })));

describeReal('isolated pinned Hercules compatibility gate', () => {
  it('requires injected LLM settings and target allowlist, then proves the complete gate', async () => {
    const apiType = process.env.LLM_MODEL_API_TYPE || 'openai';
    const model = process.env.LLM_MODEL_NAME;
    const llmBaseUrl = process.env.LLM_MODEL_BASE_URL;
    const llmApiKey = process.env.LLM_MODEL_API_KEY;
    const allowedHosts: string[] = (process.env.HERCULES_ALLOWED_HOSTS ?? '')
      .split(',')
      .map((value) => value.trim())
      .filter(Boolean);
    if (
      !model ||
      !llmBaseUrl ||
      !apiType ||
      (apiType !== 'ollama' && !llmApiKey) ||
      !allowedHosts.includes('example.com')
    ) {
      throw new Error(
        'LLM_MODEL_NAME, LLM_MODEL_BASE_URL, LLM_MODEL_API_TYPE, and example.com HERCULES_ALLOWED_HOSTS are required; keyed providers also require LLM_MODEL_API_KEY'
      );
    }

    const root = mkdtempSync(join(tmpdir(), 'unittcms-hercules-real-'));
    roots.push(root);
    const result = await runCompatibilityGate({
      workdir: root,
      evidenceRoot: root,
      feature: CANONICAL_FEATURE,
      allowedHosts,
      runtimeEnv: {
        LLM_MODEL_NAME: model,
        LLM_MODEL_BASE_URL: llmBaseUrl,
        LLM_MODEL_CLIENT_HOST: llmBaseUrl,
        LLM_MODEL_API_TYPE: apiType,
        ...(llmApiKey ? { LLM_MODEL_API_KEY: llmApiKey } : {}),
      },
      image: process.env.AUTOMATION_HERCULES_IMAGE,
      proofFactory: createCompatibilityProof,
    });

    expect(HERCULES_CONTRACT.image).toContain('@sha256:');
    expect(result).toMatchObject({ ready: true, skipped: false });
    if (llmApiKey) {
      expect(result.invocation.argv).toContain('LLM_MODEL_API_KEY');
      expect(result.invocation.argv.join(' ')).not.toContain(llmApiKey);
    } else {
      expect(result.invocation.argv).not.toContain('LLM_MODEL_API_KEY');
    }
  });
});
