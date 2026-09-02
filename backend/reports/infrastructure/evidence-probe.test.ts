import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { EvidenceStorageError, ManualEvidenceStorage } from '../../manual-execution/infrastructure/storage.js';

const roots: string[] = [];

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

describe('ManualEvidenceStorage.probe', () => {
  it('returns availability without exposing or returning evidence bytes', async () => {
    const root = await mkdtemp(join(tmpdir(), 'report-evidence-probe-'));
    roots.push(root);
    const storage = new ManualEvidenceStorage({ rootDir: root });
    const get = vi.spyOn(storage, 'get').mockResolvedValue(Buffer.from('secret bytes'));

    const result = await storage.probe({
      storageKey: 'execution/501/proof.png',
      expectedSha256: 'a'.repeat(64),
      expiresAt: new Date('2026-09-30T00:00:00.000Z'),
    });

    expect(result).toBe('available');
    expect(get).toHaveBeenCalledOnce();
    expect(JSON.stringify(result)).not.toContain('secret bytes');
  });

  it.each([
    ['evidence_not_found', 'missing'],
    ['evidence_expired', 'expired'],
    ['evidence_integrity_failed', 'unavailable'],
    ['evidence_storage_failed', 'unavailable'],
  ] as const)('maps %s to the report evidence state %s', async (code, expected) => {
    const root = await mkdtemp(join(tmpdir(), 'report-evidence-probe-'));
    roots.push(root);
    const storage = new ManualEvidenceStorage({ rootDir: root });
    vi.spyOn(storage, 'get').mockRejectedValue(new EvidenceStorageError(code));

    await expect(
      storage.probe({
        storageKey: 'execution/501/proof.png',
        expectedSha256: 'a'.repeat(64),
        expiresAt: new Date('2026-09-30T00:00:00.000Z'),
      })
    ).resolves.toBe(expected);
  });
});
