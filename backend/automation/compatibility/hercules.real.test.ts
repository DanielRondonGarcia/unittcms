import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { CANONICAL_FEATURE, HERCULES_CONTRACT, runCompatibilityGate } from './hercules.js';

const runReal = process.env.UNITTCMS_HERCULES_COMPAT_REAL === '1';
const describeReal = runReal ? describe : describe.skip;
const roots: string[] = [];

afterEach(() => roots.splice(0).forEach((root) => rmSync(root, { recursive: true, force: true })));

describeReal('isolated pinned Hercules compatibility gate', () => {
  it('requires injected LLM settings and target allowlist, then proves the complete gate', async () => {
    const llmBaseUrl = process.env.LITELLM_BASE_URL;
    const llmApiKey = process.env.LITELLM_API_KEY;
    const allowedHosts: string[] = (process.env.HERCULES_ALLOWED_HOSTS ?? '')
      .split(',')
      .map((value) => value.trim())
      .filter(Boolean);
    if (!llmBaseUrl || !llmApiKey || !allowedHosts.includes('example.test')) {
      throw new Error('LITELLM_BASE_URL, LITELLM_API_KEY, and example.test HERCULES_ALLOWED_HOSTS are required');
    }

    const root = mkdtempSync(join(tmpdir(), 'unittcms-hercules-real-'));
    roots.push(root);
    const result = await runCompatibilityGate({
      workdir: root,
      evidenceRoot: root,
      feature: CANONICAL_FEATURE,
      allowedHosts,
      runtimeEnv: { LITELLM_BASE_URL: llmBaseUrl, LITELLM_API_KEY: llmApiKey },
    });

    expect(HERCULES_CONTRACT.image).toContain('@sha256:');
    expect(result).toMatchObject({ ready: true, skipped: false });
  });
});
