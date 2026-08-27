import { describe, expect, it, vi } from 'vitest';
import {
  DEFAULT_HERCULES_LLM_PROVIDER,
  LlmConfigError,
  loadWorkerLlmConfig,
  redactWorkerLlmConfig,
  validateWorkerLlmConfig,
} from './llm-config.js';

const fixtureSecret = ['fixture', 'secret'].join('-');

describe('worker-only LLM configuration', () => {
  it('prefers the trimmed secret file over the process environment fallback', () => {
    const readSecretFile = vi.fn(() => ` ${fixtureSecret} \n`);
    const config = loadWorkerLlmConfig(
      {
        NODE_ENV: 'production',
        HERCULES_LLM_MODEL: 'gpt-4o-mini',
        LITELLM_BASE_URL: 'https://litellm.example.test/v1',
        LITELLM_API_KEY_FILE: '/run/secrets/litellm_api_key',
        LITELLM_API_KEY: 'fallback-must-not-win',
      },
      { readSecretFile }
    );

    expect(config).toMatchObject({
      provider: DEFAULT_HERCULES_LLM_PROVIDER,
      model: 'gpt-4o-mini',
      baseUrl: 'https://litellm.example.test/v1',
      apiKey: fixtureSecret,
      apiKeySource: 'file',
    });
    expect(readSecretFile).toHaveBeenCalledWith('/run/secrets/litellm_api_key');
  });

  it('allows the explicit key only outside production and never includes it in the redacted summary', () => {
    const config = loadWorkerLlmConfig({
      NODE_ENV: 'development',
      HERCULES_LLM_PROVIDER: 'azure-compatible',
      HERCULES_LLM_MODEL: 'deployment-name',
      LITELLM_BASE_URL: 'https://gateway.example.test/openai',
      LITELLM_API_KEY: fixtureSecret,
    });

    const summary = redactWorkerLlmConfig(config!);
    expect(config).toMatchObject({ apiKey: fixtureSecret, apiKeySource: 'env' });
    expect(summary).toEqual({
      provider: 'azure-compatible',
      model: 'deployment-name',
      baseUrl: 'https://gateway.example.test/openai',
      apiKeySource: 'env',
    });
    expect(JSON.stringify(summary)).not.toContain(fixtureSecret);
  });

  it('allows explicit Ollama without reading or representing a provider key', () => {
    const readSecretFile = vi.fn(() => fixtureSecret);
    const config = loadWorkerLlmConfig(
      {
        NODE_ENV: 'production',
        HERCULES_LLM_PROVIDER: 'ollama',
        HERCULES_LLM_MODEL: 'installed-local-tag',
        LITELLM_BASE_URL: 'http://host.docker.internal:11434',
        LITELLM_API_KEY_FILE: '/run/secrets/litellm_api_key',
        LITELLM_API_KEY: 'unrelated-provider-key',
        OLLAMA_API_KEY_FILE: '/run/secrets/ollama_api_key',
        OLLAMA_API_KEY: 'unrelated-cloud-key',
      },
      { readSecretFile }
    );

    expect(config).toMatchObject({
      provider: 'ollama',
      model: 'installed-local-tag',
      baseUrl: 'http://host.docker.internal:11434/',
      apiKey: '',
      apiKeySource: 'none',
    });
    expect(readSecretFile).not.toHaveBeenCalled();
    expect(redactWorkerLlmConfig(config!)).toMatchObject({ apiKeySource: 'none' });
  });

  it('loads authenticated Ollama Cloud from its worker secret file and ignores the LiteLLM key boundary', () => {
    const readSecretFile = vi.fn(() => ` ${fixtureSecret} \n`);
    const config = loadWorkerLlmConfig(
      {
        NODE_ENV: 'production',
        HERCULES_LLM_PROVIDER: 'ollama-cloud',
        HERCULES_LLM_MODEL: 'cloud-model',
        LITELLM_BASE_URL: 'https://ollama.com/api',
        LITELLM_API_KEY_FILE: '/run/secrets/litellm_api_key',
        OLLAMA_API_KEY_FILE: '/run/secrets/ollama_api_key',
        OLLAMA_API_KEY: 'fallback-must-not-win',
      },
      { readSecretFile }
    );

    expect(config).toMatchObject({
      provider: 'ollama-cloud',
      model: 'cloud-model',
      baseUrl: 'https://ollama.com/api',
      apiKey: fixtureSecret,
      apiKeySource: 'file',
    });
    expect(readSecretFile).toHaveBeenCalledOnce();
    expect(readSecretFile).toHaveBeenCalledWith('/run/secrets/ollama_api_key');
    expect(redactWorkerLlmConfig(config!)).toEqual({
      provider: 'ollama-cloud',
      model: 'cloud-model',
      baseUrl: 'https://ollama.com/api',
      apiKeySource: 'file',
    });
    expect(JSON.stringify(redactWorkerLlmConfig(config!))).not.toContain(fixtureSecret);
  });

  it('allows the Ollama Cloud environment fallback only outside production', () => {
    const config = loadWorkerLlmConfig({
      NODE_ENV: 'development',
      HERCULES_LLM_PROVIDER: 'ollama-cloud',
      HERCULES_LLM_MODEL: 'cloud-model',
      LITELLM_BASE_URL: 'https://ollama.com/api/',
      LITELLM_API_KEY_FILE: '/run/secrets/litellm_api_key',
      OLLAMA_API_KEY: fixtureSecret,
    });

    expect(config).toMatchObject({
      provider: 'ollama-cloud',
      baseUrl: 'https://ollama.com/api',
      apiKey: fixtureSecret,
      apiKeySource: 'env',
    });
    expect(JSON.stringify(redactWorkerLlmConfig(config!))).not.toContain(fixtureSecret);
  });

  it('requires the Ollama Cloud secret file in production', () => {
    expect(() =>
      loadWorkerLlmConfig({
        NODE_ENV: 'production',
        HERCULES_LLM_PROVIDER: 'ollama-cloud',
        HERCULES_LLM_MODEL: 'cloud-model',
        LITELLM_BASE_URL: 'https://ollama.com/api',
        OLLAMA_API_KEY: fixtureSecret,
      })
    ).toThrowError(new LlmConfigError('api_key_file_required', 'OLLAMA_API_KEY_FILE'));
  });

  it('requires a non-empty Ollama Cloud secret file', () => {
    expect(() =>
      loadWorkerLlmConfig(
        {
          NODE_ENV: 'production',
          HERCULES_LLM_PROVIDER: 'ollama-cloud',
          HERCULES_LLM_MODEL: 'cloud-model',
          LITELLM_BASE_URL: 'https://ollama.com/api',
          OLLAMA_API_KEY_FILE: '/run/secrets/ollama_api_key',
        },
        { readSecretFile: () => ' \n' }
      )
    ).toThrowError(new LlmConfigError('api_key_empty', 'OLLAMA_API_KEY'));
  });

  it('accepts a missing API key on a validated Ollama config', () => {
    expect(
      validateWorkerLlmConfig({
        provider: 'ollama',
        model: 'installed-local-tag',
        baseUrl: 'http://host.docker.internal:11434',
        apiKeySource: 'none',
      })
    ).toMatchObject({ apiKey: '', apiKeySource: 'none' });
  });

  it('rejects a production environment fallback and reports only a typed safe error', () => {
    expect(() =>
      loadWorkerLlmConfig({
        NODE_ENV: 'production',
        HERCULES_LLM_MODEL: 'model',
        LITELLM_BASE_URL: 'https://litellm.example.test/v1',
        LITELLM_API_KEY: fixtureSecret,
      })
    ).toThrowError(new LlmConfigError('api_key_file_required', 'LITELLM_API_KEY_FILE'));
  });

  it.each([
    ['missing model', { LITELLM_BASE_URL: 'https://litellm.example.test/v1', LITELLM_API_KEY: fixtureSecret }],
    ['missing endpoint', { HERCULES_LLM_MODEL: 'model', LITELLM_API_KEY: fixtureSecret }],
    ['missing key', { HERCULES_LLM_MODEL: 'model', LITELLM_BASE_URL: 'https://litellm.example.test/v1' }],
  ])('fails closed for %s', (_label, environment) => {
    expect(() => loadWorkerLlmConfig(environment)).toThrow(LlmConfigError);
  });

  it('keeps an explicit openai-compatible provider fail-closed without a key', () => {
    expect(() =>
      loadWorkerLlmConfig({
        HERCULES_LLM_PROVIDER: 'openai-compatible',
        HERCULES_LLM_MODEL: 'model',
        LITELLM_BASE_URL: 'https://litellm.example.test/v1',
      })
    ).toThrowError(new LlmConfigError('api_key_required', 'LITELLM_API_KEY_FILE'));
  });

  it('rejects invalid provider and credential-bearing endpoints without echoing values', () => {
    expect(() =>
      validateWorkerLlmConfig({
        provider: 'not a provider',
        model: 'model',
        baseUrl: 'https://user:password@llm.example.test/v1',
        apiKey: fixtureSecret,
        apiKeySource: 'env',
      })
    ).toThrowError(new LlmConfigError('provider_invalid', 'HERCULES_LLM_PROVIDER'));

    expect(() =>
      validateWorkerLlmConfig({
        provider: 'openai-compatible',
        model: 'model',
        baseUrl: 'https://user:password@llm.example.test/v1',
        apiKey: fixtureSecret,
        apiKeySource: 'env',
      })
    ).toThrowError(new LlmConfigError('endpoint_invalid', 'LITELLM_BASE_URL'));
  });

  it.each([
    ['non-HTTPS', 'http://ollama.com/api'],
    ['wrong host', 'https://www.ollama.com/api'],
    ['wrong path', 'https://ollama.com/v1'],
    ['URL credentials', 'https://user:password@ollama.com/api'],
    ['query credentials', 'https://ollama.com/api?key=fixture-key'],
  ])('rejects Ollama Cloud endpoint with %s', (_label, baseUrl) => {
    expect(() =>
      validateWorkerLlmConfig({
        provider: 'ollama-cloud',
        model: 'cloud-model',
        baseUrl,
        apiKey: fixtureSecret,
        apiKeySource: 'file',
      })
    ).toThrowError(new LlmConfigError('endpoint_invalid', 'LITELLM_BASE_URL'));
  });

  it('does not allow keyless Ollama Cloud validation', () => {
    expect(() =>
      validateWorkerLlmConfig({
        provider: 'ollama-cloud',
        model: 'cloud-model',
        baseUrl: 'https://ollama.com/api',
        apiKeySource: 'none',
      })
    ).toThrowError(new LlmConfigError('llm_config_invalid', 'apiKey'));
  });

  it('does not let the keyless local provider select the direct Cloud endpoint', () => {
    expect(() =>
      validateWorkerLlmConfig({
        provider: 'ollama',
        model: 'local-model',
        baseUrl: 'https://ollama.com/api',
        apiKeySource: 'none',
      })
    ).toThrowError(new LlmConfigError('endpoint_invalid', 'LITELLM_BASE_URL'));
  });
});
