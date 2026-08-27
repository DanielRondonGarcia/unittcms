import { createHash } from 'node:crypto';
import { mkdtemp, readFile, rm, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createAutomationApplication } from '../application/service.js';
import type { AutomationStore } from '../ports/index.js';
import { NeutralExecutorRegistry } from '../ports/registry.js';
import type { ArtifactInput } from './artifacts.js';
import { FileArtifactStorage, redactSecretValues } from './artifacts.js';
import { EnvironmentResolver } from './environment.js';

const roots: string[] = [];
afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});
const newRoot = async () => {
  const root = await mkdtemp(join(tmpdir(), 'unittcms-artifacts-'));
  roots.push(root);
  return root;
};
const input = (changes: Partial<ArtifactInput> = {}): ArtifactInput => ({
  executionId: 'e1',
  attempt: 1,
  content: Buffer.from('evidence'),
  mimeType: 'text/plain',
  filename: 'run.log',
  ...changes,
});

describe('secure environment boundary', () => {
  it('returns only safe connection data and references', async () => {
    const resolver = new EnvironmentResolver(async () => ({
      baseUrl: 'https://example.test/app',
      allowedHosts: ['example.test'],
      secretRefs: ['secret://llm', 'raw'],
      secretValue: 'raw',
    }));
    const result = await resolver.resolve(7);
    expect(result).toEqual({
      baseUrl: 'https://example.test/app',
      allowedHosts: ['example.test'],
      secretRefs: ['secret://llm'],
      captureVideo: false,
    });
    expect(JSON.stringify(result)).not.toContain('raw');
  });

  it.each([
    'file:///etc/passwd',
    'http://localhost',
    'http://127.0.0.1',
    'http://169.254.169.254',
    'http://[::1]',
    'http://[::ffff:127.0.0.1]',
    'https://not-allowed.test',
  ])(
    'rejects unsafe or disallowed targets: %s',
    async (baseUrl) =>
      await expect(
        new EnvironmentResolver(async () => ({ baseUrl, allowedHosts: ['example.test'], secretRefs: [] })).resolve(7)
      ).rejects.toThrow()
  );

  it.each(['file:///tmp/evidence', 'https://evil.test/redirect', 'http://192.168.1.1/'])(
    'rejects unsafe redirects: %s',
    (target) => {
      const resolver = new EnvironmentResolver(async () => null);
      expect(() => resolver.validateRedirect('https://example.test/start', '/next')).not.toThrow();
      expect(() => resolver.validateRedirect('https://example.test/start', target)).toThrow();
    }
  );
});

describe('private artifact storage', () => {
  it('creates a private random key with retention and SHA-256 metadata', async () => {
    const root = await newRoot();
    const storage = new FileArtifactStorage({ rootDir: root, retentionMs: 60_000 });
    const content = Buffer.from('<testsuite/>');
    const ref = await storage.put(
      input({
        executionId: 'execution-1',
        attempt: 2,
        filename: 'results.xml',
        mimeType: 'application/xml',
        content,
      })
    );
    expect(ref.storageKey).toMatch(/^execution\/execution-1\/attempt\/2\/[0-9a-f-]+\.xml$/);
    expect(ref.sha256).toBe(createHash('sha256').update(content).digest('hex'));
    expect(ref.expiresAt.getTime()).toBeGreaterThan(Date.now());
    expect((await stat(join(root, ref.storageKey))).isFile()).toBe(true);
    expect(await storage.get(ref.storageKey, ref.sha256)).toEqual(content);
  });

  it('rejects traversal, absolute paths, MIME/extension mismatches, and oversized evidence', async () => {
    const storage = new FileArtifactStorage({ rootDir: await newRoot(), maxBytes: 4 });
    await expect(storage.get('../outside')).rejects.toThrow();
    await expect(storage.delete('/tmp/outside')).rejects.toThrow();
    await expect(
      storage.put(input({ mimeType: 'application/xml', filename: 'x.html', content: Buffer.from('x') }))
    ).rejects.toThrow();
    await expect(
      storage.put(input({ mimeType: 'application/octet-stream', filename: 'x.bin', content: Buffer.from('x') }))
    ).rejects.toThrow();
    await expect(storage.put(input({ content: Buffer.from('12345') }))).rejects.toThrow();
  });

  it('detects tampering, verifies a restarted store, and deletes safely', async () => {
    const root = await newRoot();
    const storage = new FileArtifactStorage({ rootDir: root });
    const ref = await storage.put(input());
    await writeFile(join(root, ref.storageKey), 'changed');
    await expect(storage.get(ref.storageKey)).rejects.toThrow('artifact_integrity_failed');
    await expect(new FileArtifactStorage({ rootDir: root }).get(ref.storageKey, ref.sha256)).rejects.toThrow(
      'artifact_integrity_failed'
    );
    await storage.delete(ref.storageKey);
    await expect(readFile(join(root, ref.storageKey))).rejects.toThrow();
  });

  it('rejects configured secrets', async () => {
    const storage = new FileArtifactStorage({ rootDir: await newRoot(), secretValues: ['raw-secret'] });
    await expect(storage.put(input({ content: Buffer.from('raw-secret') }))).rejects.toThrow(
      'artifact_contains_secret'
    );
    expect(redactSecretValues('raw-secret', ['raw-secret'])).toBe('[REDACTED]');
    expect(
      [
        'Given raw-secret',
        '{"secret":"raw-secret"}',
        'log raw-secret',
        'video raw-secret',
        '<system-out>raw-secret</system-out>',
      ]
        .map((value) => redactSecretValues(value, ['raw-secret']))
        .join()
    ).not.toContain('raw-secret');
  });
});

describe('artifact application boundary', () => {
  function setup() {
    const artifact = {
      id: 'a1',
      projectId: 10,
      executionId: 'e1',
      storageKey: 'execution/e1/attempt/1/random.xml',
      sha256: 'a'.repeat(64),
      content: 'secret',
      secretValue: 'secret',
    };
    const store = {
      canAccessProject: vi.fn(async (_user: number, project: number) => project === 10),
      findExecution: vi.fn(async () => ({ id: 'e1', projectId: 10, caseId: 7, status: 'passed', attempt: 1 })),
      listArtifacts: vi.fn(async () => [artifact]),
      findArtifact: vi.fn(async () => artifact),
    };
    const storage = { put: vi.fn(), get: vi.fn(async () => Buffer.from('private evidence')) };
    const app = createAutomationApplication({
      store: store as unknown as AutomationStore,
      registry: new NeutralExecutorRegistry(),
      artifactStorage: storage,
    });
    return { app, store, storage };
  }

  it('whitelists metadata and downloads only after project authorization', async () => {
    const { app, store, storage } = setup();
    const listed = await app.artifacts(1, 'e1');
    const downloaded = await app.download(1, 'a1');
    expect(listed[0]).toEqual(expect.objectContaining({ id: 'a1', sha256: 'a'.repeat(64) }));
    expect(JSON.stringify(listed)).not.toContain('secret');
    expect(downloaded).toMatchObject({
      artifactId: 'a1',
      content: Buffer.from('private evidence').toString('base64'),
      encoding: 'base64',
    });
    expect(storage.get).toHaveBeenCalledWith(listed[0].storageKey, 'a'.repeat(64));
    storage.get.mockClear();
    store.canAccessProject.mockResolvedValue(false);
    await expect(app.artifacts(2, 'e1')).rejects.toMatchObject({ status: 403 });
    await expect(app.download(2, 'a1')).rejects.toMatchObject({ status: 404 });
    expect(storage.get).not.toHaveBeenCalled();
  });
});
