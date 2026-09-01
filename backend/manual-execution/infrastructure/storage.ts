import { createHash, randomUUID } from 'node:crypto';
import { lstat, mkdir, readFile, unlink, writeFile } from 'node:fs/promises';
import { dirname, extname, isAbsolute, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

export const MAX_EVIDENCE_BYTES = 10 * 1024 * 1024;
export const MAX_EVIDENCE_FILES = 10;
export const EVIDENCE_RETENTION_MS = 30 * 24 * 60 * 60 * 1000;

export type ManualEvidenceStorageOptions = {
  rootDir?: string;
  maxBytes?: number;
  retentionMs?: number;
};

export type ManualEvidenceInput = {
  executionId: number | string;
  content: Uint8Array;
  mimeType: string;
  filename: string;
  expectedSha256?: string;
  expiresAt?: Date;
};

export type ManualEvidenceRef = {
  storageKey: string;
  mimeType: 'image/png' | 'image/jpeg';
  size: number;
  sha256: string;
  expiresAt: Date;
};

export class EvidenceStorageError extends Error {
  code: string;

  constructor(code: string) {
    super(code);
    this.name = 'EvidenceStorageError';
    this.code = code;
  }
}

function isInside(root: string, target: string): boolean {
  const child = relative(root, target);
  return child !== '' && !child.startsWith('..') && !isAbsolute(child);
}

function isSameOrInside(root: string, target: string): boolean {
  const comparableRoot = process.platform === 'win32' ? root.toLowerCase() : root;
  const comparableTarget = process.platform === 'win32' ? target.toLowerCase() : target;
  const child = relative(comparableRoot, comparableTarget);
  return child === '' || (!child.startsWith('..') && !isAbsolute(child));
}

function staticPublicRoots(): string[] {
  const moduleDirectory = dirname(fileURLToPath(import.meta.url));
  return [
    resolve(moduleDirectory, '../../public'),
    resolve(process.cwd(), 'backend/public'),
    resolve(process.cwd(), 'public'),
  ];
}

function assertPrivateRoot(root: string): void {
  if (staticPublicRoots().some((publicRoot) => isSameOrInside(publicRoot, root)))
    throw new EvidenceStorageError('evidence_root_invalid');
}

function safeExecutionId(value: number | string): string {
  const id = Number(value);
  if (!Number.isSafeInteger(id) || id <= 0) throw new EvidenceStorageError('evidence_scope_invalid');
  return String(id);
}

function safeKey(root: string, storageKey: string): string {
  if (!storageKey || storageKey.includes('\0') || storageKey.includes('\\') || isAbsolute(storageKey))
    throw new EvidenceStorageError('evidence_path_invalid');
  if (storageKey.split('/').some((part) => !part || part === '..'))
    throw new EvidenceStorageError('evidence_path_invalid');
  const target = resolve(root, storageKey);
  if (!isInside(root, target)) throw new EvidenceStorageError('evidence_path_invalid');
  return target;
}

function extensionAndMime(
  filename: string,
  mimeType: string
): { extension: '.png' | '.jpg' | '.jpeg'; mimeType: 'image/png' | 'image/jpeg' } {
  const normalizedMime = mimeType.split(';', 1)[0].trim().toLowerCase();
  const extension = extname(filename || '').toLowerCase();
  if (normalizedMime === 'image/png' && extension !== '.png')
    throw new EvidenceStorageError('evidence_extension_invalid');
  if (normalizedMime === 'image/jpeg' && extension !== '.jpg' && extension !== '.jpeg')
    throw new EvidenceStorageError('evidence_extension_invalid');
  if (normalizedMime !== 'image/png' && normalizedMime !== 'image/jpeg')
    throw new EvidenceStorageError('evidence_mime_invalid');
  return { extension: extension as '.png' | '.jpg' | '.jpeg', mimeType: normalizedMime as 'image/png' | 'image/jpeg' };
}

function hasImageMagic(bytes: Uint8Array, mimeType: 'image/png' | 'image/jpeg'): boolean {
  if (mimeType === 'image/png') return Buffer.from(bytes.subarray(0, 8)).equals(Buffer.from('89504e470d0a1a0a', 'hex'));
  return bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff;
}

async function rejectSymlink(root: string, storageKey: string): Promise<void> {
  const parts = storageKey.split('/');
  let current = root;
  for (const part of parts) {
    current = resolve(current, part);
    try {
      const entry = await lstat(current);
      if (entry.isSymbolicLink()) throw new EvidenceStorageError('evidence_path_invalid');
    } catch (error) {
      if (error instanceof EvidenceStorageError || (error as { code?: string }).code !== 'ENOENT') throw error;
      return;
    }
  }
}

export class ManualEvidenceStorage {
  private readonly rootDir: string;
  private readonly maxBytes: number;
  private readonly retentionMs: number;
  private readonly refs = new Map<string, Date>();

  constructor(options: ManualEvidenceStorageOptions = {}) {
    this.rootDir = resolve(options.rootDir ?? resolve(process.cwd(), 'backend/private/manual-execution-evidence'));
    assertPrivateRoot(this.rootDir);
    this.maxBytes = options.maxBytes ?? MAX_EVIDENCE_BYTES;
    this.retentionMs = options.retentionMs ?? EVIDENCE_RETENTION_MS;
  }

  async put(input: ManualEvidenceInput): Promise<ManualEvidenceRef> {
    const executionId = safeExecutionId(input.executionId);
    const { extension, mimeType } = extensionAndMime(input.filename, input.mimeType);
    const bytes = Buffer.from(input.content);
    if (bytes.length > this.maxBytes) throw new EvidenceStorageError('evidence_size_exceeded');
    if (!hasImageMagic(bytes, mimeType)) throw new EvidenceStorageError('evidence_content_invalid');
    const sha256 = createHash('sha256').update(bytes).digest('hex');
    if (
      input.expectedSha256 !== undefined &&
      (!/^[a-f0-9]{64}$/i.test(input.expectedSha256) || input.expectedSha256.toLowerCase() !== sha256)
    )
      throw new EvidenceStorageError('evidence_hash_invalid');
    const expiresAt = new Date(input.expiresAt ?? Date.now() + this.retentionMs);
    if (Number.isNaN(expiresAt.getTime())) throw new EvidenceStorageError('evidence_retention_invalid');

    const storageKey = `execution/${executionId}/${randomUUID()}${extension}`;
    const target = safeKey(this.rootDir, storageKey);
    try {
      await mkdir(dirname(target), { recursive: true });
      await rejectSymlink(this.rootDir, storageKey);
      await writeFile(target, bytes, { flag: 'wx', mode: 0o600 });
      this.refs.set(storageKey, expiresAt);
      return { storageKey, mimeType, size: bytes.length, sha256, expiresAt };
    } catch (error) {
      await unlink(target).catch(() => undefined);
      if (error instanceof EvidenceStorageError) throw error;
      throw new EvidenceStorageError('evidence_storage_failed');
    }
  }

  async get(storageKey: string, expectedSha256?: string, expiresAt?: Date): Promise<Uint8Array> {
    const target = safeKey(this.rootDir, storageKey);
    await rejectSymlink(this.rootDir, storageKey);
    const expiry = expiresAt ?? this.refs.get(storageKey);
    if (expiry && expiry.getTime() <= Date.now()) throw new EvidenceStorageError('evidence_expired');
    try {
      const entry = await lstat(target);
      if (!entry.isFile() || entry.isSymbolicLink()) throw new EvidenceStorageError('evidence_path_invalid');
      const bytes = await readFile(target);
      if (expectedSha256 && createHash('sha256').update(bytes).digest('hex') !== expectedSha256.toLowerCase())
        throw new EvidenceStorageError('evidence_integrity_failed');
      return bytes;
    } catch (error) {
      if (error instanceof EvidenceStorageError) throw error;
      if ((error as { code?: string }).code === 'ENOENT') throw new EvidenceStorageError('evidence_not_found');
      throw new EvidenceStorageError('evidence_storage_failed');
    }
  }

  async delete(storageKey: string): Promise<void> {
    const target = safeKey(this.rootDir, storageKey);
    await rejectSymlink(this.rootDir, storageKey);
    try {
      const entry = await lstat(target);
      if (!entry.isFile() || entry.isSymbolicLink()) throw new EvidenceStorageError('evidence_path_invalid');
      await unlink(target);
    } catch (error) {
      if (error instanceof EvidenceStorageError) throw error;
      if ((error as { code?: string }).code !== 'ENOENT') throw new EvidenceStorageError('evidence_storage_failed');
    }
    this.refs.delete(storageKey);
  }

  async cleanupExpired(records: Array<{ storageKey: string; expiresAt: Date }>, now = new Date()): Promise<void> {
    for (const record of records) {
      if (record.expiresAt.getTime() <= now.getTime()) await this.delete(record.storageKey);
    }
  }
}
