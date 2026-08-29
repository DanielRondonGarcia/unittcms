import {
  hasExplicitUrlPort,
  normalizeEnvironmentTarget,
  normalizeHostList,
  validateHostAllowlist,
} from '../compatibility/hercules.js';
import type { EnvironmentResolver as EnvironmentResolverPort, ResolvedEnvironment } from '../ports/index.js';

export type EnvironmentRecord = ResolvedEnvironment;
type Source = (id: number) => Promise<EnvironmentRecord | null> | EnvironmentRecord | null;

function parseUrl(value: string, errorCode: 'environment_url_invalid' | 'environment_target_rejected'): URL {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new Error(errorCode);
  }
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

    const baseTarget = normalizeEnvironmentTarget(record.baseUrl);
    const configuredHosts = normalizeHostList(Array.isArray(record.allowedHosts) ? record.allowedHosts : []);
    if (configuredHosts.length > 0 && !configuredHosts.includes(baseTarget.allowedHosts[0]))
      throw new Error('environment_target_rejected');
    const target = normalizeEnvironmentTarget(record.baseUrl, configuredHosts);
    const refs = (Array.isArray(record.secretRefs) ? record.secretRefs : [])
      .filter((ref) => typeof ref === 'string' && /^(?:secret|vault|env):\/\//i.test(ref.trim()))
      .map((ref) => ref.trim());
    return Object.freeze({
      baseUrl: target.baseUrl,
      allowedHosts: [...target.allowedHosts],
      secretRefs: [...refs],
      captureVideo: record.captureVideo === true,
    });
  }

  validateRedirect(sourceUrl: string, targetUrl: string, hosts?: readonly string[]): string {
    if (hasExplicitUrlPort(sourceUrl)) throw new Error('environment_target_rejected');
    const source = parseUrl(sourceUrl, 'environment_url_invalid');
    const targetHosts = normalizeHostList(hosts ?? [source.hostname]);
    if (!validateHostAllowlist([sourceUrl], targetHosts).allowed) throw new Error('environment_target_rejected');

    if (hasExplicitUrlPort(targetUrl)) throw new Error('environment_target_rejected');
    let target: URL;
    try {
      target = new URL(targetUrl, source);
    } catch {
      throw new Error('environment_url_invalid');
    }
    if (!validateHostAllowlist([target.toString()], targetHosts).allowed)
      throw new Error('environment_target_rejected');
    return target.toString();
  }
}
