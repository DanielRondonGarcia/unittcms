import { createHash } from 'node:crypto';
import { mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve, win32 } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { ManualEvidenceStorage } from './storage.js';

const png = Buffer.from('89504e470d0a1a0a', 'hex');
const jpeg = Buffer.from('ffd8ff00ffd9', 'hex');
const roots: string[] = [];

async function makeStorage(options = {}) {
  const root = await mkdtemp(join(tmpdir(), 'manual-evidence-'));
  roots.push(root);
  return new ManualEvidenceStorage({ rootDir: root, ...options });
}

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

describe('ManualEvidenceStorage', () => {
  it('stores private PNG/JPEG bytes with a server-computed SHA-256', async () => {
    const storage = await makeStorage();
    const ref = await storage.put({
      executionId: 12,
      content: png,
      mimeType: 'image/png',
      filename: 'proof.png',
      expectedSha256: createHash('sha256').update(png).digest('hex'),
    });

    expect(ref.mimeType).toBe('image/png');
    expect(ref.sha256).toBe(createHash('sha256').update(png).digest('hex'));
    expect(ref.storageKey).not.toContain('public');
    expect(await storage.get(ref.storageKey, ref.sha256)).toEqual(png);
    expect(await readdir(join((storage as { rootDir: string }).rootDir, 'execution', '12'))).toHaveLength(1);
  });

  it.each([
    ['wrong magic bytes', Buffer.from('not-an-image'), 'image/png', 'proof.png', 'evidence_content_invalid'],
    ['wrong MIME', png, 'image/gif', 'proof.png', 'evidence_mime_invalid'],
    ['wrong extension', png, 'image/png', 'proof.jpg', 'evidence_extension_invalid'],
  ])('rejects %s before writing', async (_name, content, mimeType, filename, code) => {
    const storage = await makeStorage();

    await expect(storage.put({ executionId: 12, content, mimeType, filename })).rejects.toMatchObject({ code });
    await expect(readdir((storage as { rootDir: string }).rootDir)).resolves.toEqual([]);
  });

  it('rejects oversize and client hash mismatches without leaving artifacts', async () => {
    const storage = await makeStorage({ maxBytes: 4 });

    await expect(
      storage.put({ executionId: 12, content: png, mimeType: 'image/png', filename: 'proof.png' })
    ).rejects.toMatchObject({
      code: 'evidence_size_exceeded',
    });
    const hashStorage = await makeStorage();
    await expect(
      hashStorage.put({
        executionId: 12,
        content: png,
        mimeType: 'image/png',
        filename: 'proof.png',
        expectedSha256: '0'.repeat(64),
      })
    ).rejects.toMatchObject({ code: 'evidence_hash_invalid' });
    await expect(readdir((storage as { rootDir: string }).rootDir)).resolves.toEqual([]);
  });

  it('rejects traversal and symlink-like storage keys', async () => {
    const storage = await makeStorage();

    await expect(storage.get('../outside.png')).rejects.toMatchObject({ code: 'evidence_path_invalid' });
    await expect(storage.delete('execution/../outside.png')).rejects.toMatchObject({ code: 'evidence_path_invalid' });
  });

  const publicRoot = resolve(process.cwd(), 'backend', 'public');
  const rejectedPublicRoots: Array<[string, string]> = [
    ['absolute public root', publicRoot],
    ['absolute public descendant', resolve(publicRoot, 'manual-evidence')],
    ['relative public root', 'backend/public'],
    ['relative public descendant alias', 'backend/public/./manual-evidence/../manual-evidence'],
    ['relative public root alias', 'backend/public/manual-evidence/..'],
    ...(process.platform === 'win32'
      ? [
          ['Windows separator descendant', win32.join(process.cwd(), 'backend', 'public', 'manual-evidence')],
          ['Windows case alias', publicRoot.toUpperCase()],
        ]
      : []),
  ];

  it.each(rejectedPublicRoots)('rejects %s', (_label, rootDir) => {
    expect(() => new ManualEvidenceStorage({ rootDir })).toThrowError(
      expect.objectContaining({ code: 'evidence_root_invalid' })
    );
  });

  const validPrivateRoots: Array<[string, string]> = [
    ['relative private root', 'backend/private/manual-execution-evidence'],
    ['absolute private root', resolve(process.cwd(), 'backend', 'private', 'manual-execution-evidence')],
    ['public-prefix sibling', resolve(process.cwd(), 'backend', 'public-files', 'manual-evidence')],
  ];

  it.each(validPrivateRoots)('allows %s', (_label, rootDir) => {
    expect(() => new ManualEvidenceStorage({ rootDir })).not.toThrow();
  });

  it('returns a typed write failure without leaving a partial object', async () => {
    const storage = await makeStorage();
    const root = (storage as { rootDir: string }).rootDir;
    await rm(root, { recursive: true, force: true });
    await writeFile(root, 'root is not a directory');

    await expect(
      storage.put({ executionId: 12, content: png, mimeType: 'image/png', filename: 'proof.png' })
    ).rejects.toMatchObject({ code: 'evidence_storage_failed' });
    await expect(readFile(root, 'utf8')).resolves.toBe('root is not a directory');
  });

  it('cleans a persisted object when its retention deadline passes', async () => {
    const storage = await makeStorage();
    const ref = await storage.put({ executionId: 12, content: jpeg, mimeType: 'image/jpeg', filename: 'proof.jpeg' });

    await storage.cleanupExpired([{ storageKey: ref.storageKey, expiresAt: new Date(Date.now() - 1) }]);
    await expect(readFile((storage as { rootDir: string }).rootDir + '/' + ref.storageKey)).rejects.toMatchObject({
      code: 'ENOENT',
    });
  });
});
