import { isIP } from 'node:net';
import { validateHostAllowlist } from '../compatibility/hercules.js';
import type { EnvironmentResolver as EnvironmentResolverPort, ResolvedEnvironment } from '../ports/index.js';

export type EnvironmentRecord = ResolvedEnvironment;
type Source = (id: number) => Promise<EnvironmentRecord | null> | EnvironmentRecord | null;

const hostname = (value: string) =>
  value
    .toLowerCase()
    .replace(/^\[|\]$/g, '')
    .replace(/\.$/, '');

const allowedHosts = (values: readonly string[]) => [...new Set(values.map(hostname).filter(Boolean))];

function safeUrl(value: string, hosts: readonly string[]): URL {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new Error('environment_url_invalid');
  }
  const host = hostname(url.hostname);
  const mappedLiteral = isIP(host) === 6 && /^::ffff:/i.test(host);
  if (
    !['http:', 'https:'].includes(url.protocol) ||
    url.username ||
    url.password ||
    mappedLiteral ||
    !validateHostAllowlist([url.toString()], hosts).allowed
  )
    throw new Error('environment_target_rejected');
  return url;
}

export class EnvironmentResolver implements EnvironmentResolverPort {
  private readonly load: (id: number) => Promise<EnvironmentRecord | null>;
  constructor(source: Source) {
    this.load = async (id) => source(id);
  }

  async resolve(environmentId: number): Promise<EnvironmentRecord> {
    const record = await this.load(environmentId);
    if (!record) throw new Error('environment_not_found');
    let configuredUrl: URL;
    try {
      configuredUrl = new URL(record.baseUrl);
    } catch {
      throw new Error('environment_url_invalid');
    }
    const configuredHosts = allowedHosts(Array.isArray(record.allowedHosts) ? record.allowedHosts : []);
    const hosts = allowedHosts([configuredUrl.hostname]);
    if (configuredHosts.length > 0 && !configuredHosts.includes(hosts[0]))
      throw new Error('environment_target_rejected');
    const url = safeUrl(configuredUrl.toString(), hosts);
    const refs = (Array.isArray(record.secretRefs) ? record.secretRefs : [])
      .filter((ref) => typeof ref === 'string' && /^(?:secret|vault|env):\/\//i.test(ref.trim()))
      .map((ref) => ref.trim());
    return Object.freeze({
      baseUrl: url.toString(),
      allowedHosts: [...hosts],
      secretRefs: [...refs],
      captureVideo: record.captureVideo === true,
    });
  }

  validateRedirect(sourceUrl: string, targetUrl: string, hosts?: readonly string[]): string {
    const source = new URL(sourceUrl);
    const targetHosts = allowedHosts(hosts ?? [source.hostname]);
    safeUrl(source.toString(), targetHosts);
    return safeUrl(new URL(targetUrl, source).toString(), targetHosts).toString();
  }
}
