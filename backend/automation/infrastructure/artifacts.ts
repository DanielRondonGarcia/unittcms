import { createHash, randomUUID } from 'node:crypto';
import { lstat, mkdir, readFile, unlink, writeFile } from 'node:fs/promises';
import { dirname, extname, isAbsolute, relative, resolve } from 'node:path';
import { containsSecretBytes, redactSecretMaterial } from '../compatibility/diagnostics.js';
import type { ArtifactStorage } from '../ports/index.js';

export type ArtifactInput = {
  executionId: string;
  attempt: number;
  content: Uint8Array;
  mimeType: string;
  filename?: string;
  kind?: string;
  expiresAt?: Date;
};
export type ArtifactRef = {
  storageKey: string;
  hash: string;
  sha256: string;
  mimeType: string;
  size: number;
  expiresAt: Date;
};
type Options = { rootDir?: string; maxBytes?: number; retentionMs?: number; secretValues?: readonly string[] };

const MIME_EXTENSIONS: Record<string, string[]> = {
  'application/json': ['.json'],
  'application/xml': ['.xml'],
  'text/xml': ['.xml'],
  'text/html': ['.html'],
  'text/plain': ['.log', '.txt'],
  'image/jpeg': ['.jpg', '.jpeg'],
  'image/png': ['.png'],
  'video/mp4': ['.mp4'],
  'video/webm': ['.webm'],
};
const TEXT_MIME_TYPES = new Set(['application/json', 'application/xml', 'text/xml', 'text/html', 'text/plain']);

export function redactSecretValues(value: string, secrets: readonly string[]): string {
  return redactSecretMaterial(value, secrets);
}

function contained(root: string, target: string): boolean {
  const child = relative(root, target);
  return Boolean(child) && !child.startsWith('..') && !isAbsolute(child);
}

export function assertSafeStorageKey(root: string, storageKey: string): string {
  if (!storageKey || storageKey.includes('\0') || storageKey.includes('\\') || isAbsolute(storageKey))
    throw new Error('artifact_path_invalid');
  if (storageKey.split('/').some((part) => part === '..')) throw new Error('artifact_path_invalid');
  const target = resolve(root, storageKey);
  if (!contained(root, target)) throw new Error('artifact_path_invalid');
  return target;
}

function assertPrivateRoot(root: string): void {
  const candidates = [resolve(process.cwd(), 'backend/public/uploads'), resolve(process.cwd(), 'public/uploads')];
  if (candidates.some((publicRoot) => resolve(publicRoot) === root || contained(publicRoot, root)))
    throw new Error('artifact_root_must_be_private');
}

function prepare(input: ArtifactInput, options: Options): { bytes: Buffer; ref: ArtifactRef } {
  const mimeType = input.mimeType.split(';', 1)[0].trim().toLowerCase();
  const extensions = MIME_EXTENSIONS[mimeType];
  if (!extensions) throw new Error('artifact_mime_not_allowed');
  const filenameExtension = extname(input.filename ?? '').toLowerCase();
  const extension = filenameExtension || extensions[0];
  if (!extensions.includes(extension)) throw new Error('artifact_extension_not_allowed');
  if (!/^[A-Za-z0-9_-]+$/.test(input.executionId) || !Number.isSafeInteger(input.attempt) || input.attempt < 1)
    throw new Error('artifact_scope_invalid');
  const bytes = Buffer.from(input.content);
  const maxBytes = options.maxBytes ?? 50 * 1024 * 1024;
  if (bytes.byteLength > maxBytes) throw new Error('artifact_size_exceeded');
  const text = TEXT_MIME_TYPES.has(mimeType) ? bytes.toString('utf8') : bytes.toString('latin1');
  if (TEXT_MIME_TYPES.has(mimeType) && text.includes('\ufffd')) throw new Error('artifact_unscannable');
  if (containsSecretBytes(bytes, options.secretValues ?? [])) throw new Error('artifact_contains_secret');
  const sha256 = createHash('sha256').update(bytes).digest('hex');
  const expiresAt = input.expiresAt ?? new Date(Date.now() + (options.retentionMs ?? 7 * 24 * 60 * 60 * 1000));
  if (Number.isNaN(expiresAt.getTime())) throw new Error('artifact_retention_invalid');
  const storageKey = `execution/${input.executionId}/attempt/${input.attempt}/${randomUUID()}${extension}`;
  const ref = { storageKey, hash: sha256, sha256, mimeType, size: bytes.byteLength, expiresAt: new Date(expiresAt) };
  return { bytes, ref };
}

export class FileArtifactStorage implements ArtifactStorage {
  private readonly rootDir: string;
  private readonly options: Options;
  private readonly refs = new Map<string, ArtifactRef>();

  constructor(options: Options = {}) {
    this.rootDir = resolve(options.rootDir ?? resolve(process.cwd(), 'private/automation-artifacts'));
    assertPrivateRoot(this.rootDir);
    this.options = options;
  }

  async put(input: ArtifactInput): Promise<ArtifactRef> {
    const prepared = prepare(input, this.options);
    const target = assertSafeStorageKey(this.rootDir, prepared.ref.storageKey);
    await mkdir(dirname(target), { recursive: true });
    await writeFile(target, prepared.bytes, { flag: 'wx', mode: 0o600 });
    this.refs.set(prepared.ref.storageKey, prepared.ref);
    return { ...prepared.ref };
  }

  async get(storageKey: string, expectedSha256?: string): Promise<Uint8Array> {
    const target = assertSafeStorageKey(this.rootDir, storageKey);
    const ref = this.refs.get(storageKey);
    const entry = await lstat(target);
    if (!entry.isFile() || entry.isSymbolicLink()) throw new Error('artifact_path_invalid');
    if (ref && ref.expiresAt.getTime() <= Date.now()) throw new Error('artifact_expired');
    const bytes = await readFile(target);
    const expected = expectedSha256 || ref?.sha256;
    if (expected && createHash('sha256').update(bytes).digest('hex') !== expected)
      throw new Error('artifact_integrity_failed');
    return bytes;
  }

  async delete(storageKey: string): Promise<void> {
    const target = assertSafeStorageKey(this.rootDir, storageKey);
    try {
      const entry = await lstat(target);
      if (!entry.isFile() || entry.isSymbolicLink()) throw new Error('artifact_path_invalid');
      await unlink(target);
    } catch (error) {
      if ((error as { code?: string }).code !== 'ENOENT') throw error;
    }
    this.refs.delete(storageKey);
  }
}

export interface S3CompatibleObjectStore {
  putObject(storageKey: string, content: Uint8Array, metadata: Record<string, string>): Promise<void>;
  getObject(storageKey: string): Promise<Uint8Array>;
  deleteObject(storageKey: string): Promise<void>;
}

// S3/MinIO adapters implement the neutral ArtifactStorage port without a cloud SDK here.
