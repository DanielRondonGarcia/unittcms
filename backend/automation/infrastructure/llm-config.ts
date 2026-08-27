import { readFileSync } from 'node:fs';

export const DEFAULT_HERCULES_LLM_PROVIDER = 'openai-compatible';

export type LlmConfigErrorCode =
  | 'llm_config_invalid'
  | 'provider_invalid'
  | 'model_required'
  | 'model_invalid'
  | 'endpoint_required'
  | 'endpoint_invalid'
  | 'api_key_required'
  | 'api_key_empty'
  | 'api_key_invalid'
  | 'api_key_file_required'
  | 'api_key_file_invalid'
  | 'api_key_file_unreadable';

export class LlmConfigError extends Error {
  readonly code: LlmConfigErrorCode;
  readonly field: string;

  constructor(code: LlmConfigErrorCode, field: string) {
    super(code);
    this.name = 'LlmConfigError';
    this.code = code;
    this.field = field;
  }
}

export type WorkerLlmConfig = Readonly<{
  provider: string;
  model: string;
  baseUrl: string;
  apiKey: string;
  apiKeySource: 'file' | 'env' | 'none';
}>;

export type WorkerLlmConfigSummary = Readonly<{
  provider: string;
  model: string;
  baseUrl: string;
  apiKeySource: 'file' | 'env' | 'none';
}>;

type Environment = Readonly<Record<string, string | undefined>>;
type SecretFileReader = (filePath: string) => string;
type LoadOptions = {
  required?: boolean;
  nodeEnv?: string;
  readSecretFile?: SecretFileReader;
};

const PROVIDER_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/;
const MAX_MODEL_LENGTH = 256;
const MAX_ENDPOINT_LENGTH = 2048;
const MAX_SECRET_LENGTH = 8192;

function text(value: unknown, code: LlmConfigErrorCode, field: string, maxLength: number): string {
  if (typeof value !== 'string') throw new LlmConfigError(code, field);
  const result = value.trim();
  if (!result || result.length > maxLength || /[\u0000-\u001f\u007f]/.test(result))
    throw new LlmConfigError(code, field);
  return result;
}

function provider(value: unknown): string {
  const result = text(value, 'provider_invalid', 'HERCULES_LLM_PROVIDER', 128);
  if (!PROVIDER_PATTERN.test(result)) throw new LlmConfigError('provider_invalid', 'HERCULES_LLM_PROVIDER');
  return result;
}

function model(value: unknown): string {
  return text(value, 'model_invalid', 'HERCULES_LLM_MODEL', MAX_MODEL_LENGTH);
}

function endpoint(value: unknown, providerValue: string): string {
  const result = text(value, 'endpoint_invalid', 'LITELLM_BASE_URL', MAX_ENDPOINT_LENGTH);
  let url: URL;
  try {
    url = new URL(result);
  } catch {
    throw new LlmConfigError('endpoint_invalid', 'LITELLM_BASE_URL');
  }
  if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password)
    throw new LlmConfigError('endpoint_invalid', 'LITELLM_BASE_URL');
  const ollamaCloudHost = url.hostname.toLowerCase() === 'ollama.com';
  const ollamaCloudEndpoint =
    url.origin === 'https://ollama.com' && ['/api', '/api/'].includes(url.pathname) && !url.search && !url.hash;
  if ((providerValue === 'ollama-cloud' && !ollamaCloudEndpoint) || (providerValue === 'ollama' && ollamaCloudHost))
    throw new LlmConfigError('endpoint_invalid', 'LITELLM_BASE_URL');
  if (providerValue === 'ollama-cloud' && url.pathname === '/api/') url.pathname = '/api';
  return url.toString();
}

function apiKey(value: unknown, field = 'LITELLM_API_KEY'): string {
  if (typeof value !== 'string') throw new LlmConfigError('api_key_required', field);
  const result = value.trim();
  if (!result) throw new LlmConfigError('api_key_empty', field);
  if (result.length > MAX_SECRET_LENGTH || /[\u0000-\u001f\u007f]/.test(result))
    throw new LlmConfigError('api_key_invalid', field);
  return result;
}

function loadApiKey(
  environment: Environment,
  options: LoadOptions,
  fileVariable: string,
  environmentVariable: string
): { value: string; source: 'file' | 'env' } {
  if (environment[fileVariable] !== undefined) {
    const filePath = environment[fileVariable]!.trim();
    if (!filePath || filePath.includes('\u0000')) throw new LlmConfigError('api_key_file_invalid', fileVariable);
    const readSecretFile = options.readSecretFile ?? ((path: string) => readFileSync(path, 'utf8'));
    try {
      return { value: readSecretFile(filePath), source: 'file' };
    } catch {
      throw new LlmConfigError('api_key_file_unreadable', fileVariable);
    }
  }
  if (environment[environmentVariable] !== undefined) {
    if ((options.nodeEnv ?? environment.NODE_ENV) === 'production')
      throw new LlmConfigError('api_key_file_required', fileVariable);
    return { value: environment[environmentVariable]!, source: 'env' };
  }
  throw new LlmConfigError('api_key_required', fileVariable);
}

export function validateWorkerLlmConfig(value: unknown): WorkerLlmConfig {
  if (!value || typeof value !== 'object') throw new LlmConfigError('llm_config_invalid', 'config');
  const source = value as Record<string, unknown>;
  const providerValue = provider(source.provider);
  const apiKeySource = source.apiKeySource;
  if (apiKeySource !== 'file' && apiKeySource !== 'env' && apiKeySource !== 'none')
    throw new LlmConfigError('llm_config_invalid', 'apiKeySource');
  let key = '';
  if (apiKeySource === 'none') {
    if (
      providerValue !== 'ollama' ||
      (source.apiKey !== undefined && (typeof source.apiKey !== 'string' || source.apiKey.trim() !== ''))
    )
      throw new LlmConfigError('llm_config_invalid', 'apiKey');
  } else {
    key = apiKey(source.apiKey, providerValue === 'ollama-cloud' ? 'OLLAMA_API_KEY' : 'LITELLM_API_KEY');
  }
  return Object.freeze({
    provider: providerValue,
    model: model(source.model),
    baseUrl: endpoint(source.baseUrl, providerValue),
    apiKey: key,
    apiKeySource,
  });
}

export function loadWorkerLlmConfig(
  environment: Environment = process.env,
  options: LoadOptions = {}
): WorkerLlmConfig | undefined {
  const configured = [
    environment.HERCULES_LLM_PROVIDER,
    environment.HERCULES_LLM_MODEL,
    environment.LITELLM_BASE_URL,
    environment.LITELLM_API_KEY_FILE,
    environment.LITELLM_API_KEY,
    environment.OLLAMA_API_KEY_FILE,
    environment.OLLAMA_API_KEY,
  ].some((value) => value !== undefined);
  if (options.required === false && !configured) return undefined;

  const providerValue =
    environment.HERCULES_LLM_PROVIDER === undefined ? DEFAULT_HERCULES_LLM_PROVIDER : environment.HERCULES_LLM_PROVIDER;
  const modelValue = environment.HERCULES_LLM_MODEL;
  if (modelValue === undefined) throw new LlmConfigError('model_required', 'HERCULES_LLM_MODEL');
  if (environment.LITELLM_BASE_URL === undefined) throw new LlmConfigError('endpoint_required', 'LITELLM_BASE_URL');

  const normalizedProvider = provider(providerValue);
  if (normalizedProvider === 'ollama') {
    return validateWorkerLlmConfig({
      provider: normalizedProvider,
      model: modelValue,
      baseUrl: environment.LITELLM_BASE_URL,
      apiKey: '',
      apiKeySource: 'none',
    });
  }

  const fileVariable = normalizedProvider === 'ollama-cloud' ? 'OLLAMA_API_KEY_FILE' : 'LITELLM_API_KEY_FILE';
  const environmentVariable = normalizedProvider === 'ollama-cloud' ? 'OLLAMA_API_KEY' : 'LITELLM_API_KEY';
  const { value: secret, source: apiKeySource } = loadApiKey(environment, options, fileVariable, environmentVariable);

  return validateWorkerLlmConfig({
    provider: normalizedProvider,
    model: modelValue,
    baseUrl: environment.LITELLM_BASE_URL,
    apiKey: secret,
    apiKeySource,
  });
}

export function redactWorkerLlmConfig(config: WorkerLlmConfig): WorkerLlmConfigSummary {
  return Object.freeze({
    provider: config.provider,
    model: config.model,
    baseUrl: config.baseUrl,
    apiKeySource: config.apiKeySource,
  });
}
