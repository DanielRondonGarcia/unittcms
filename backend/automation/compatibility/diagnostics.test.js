import { describe, expect, it } from 'vitest';
import { containsSecretBytes, containsSecretMaterial, redactSecretMaterial } from './diagnostics.js';

describe('diagnostic secret handling', () => {
  it.each([
    ['api_key=fixture-secret', 'api_key=[REDACTED]'],
    ['api_key: fixture-secret, next=value', 'api_key: [REDACTED], next=value'],
    ['{"outer":{"api_key":"fixture-secret"}}', '{"outer":{"api_key":"[REDACTED]"}}'],
    ['{"payload":"{\\"password\\":\\"fixture-password\\"}"}', '{"payload":"{\\"password\\":\\"[REDACTED]\\"}"}'],
    ['Authorization: Bearer fixture-bearer', 'Authorization: Bearer [REDACTED]'],
    ['Bearer "fixture-bearer"', 'Bearer "[REDACTED]"'],
    ['Bearer [fixture bearer]', 'Bearer [REDACTED]'],
    ['Authorization: Bearer [fixture bearer]', 'Authorization: Bearer [REDACTED]'],
  ])('redacts %s without corrupting delimiters', (value, expected) => {
    expect(redactSecretMaterial(value)).toBe(expected);
    expect(containsSecretMaterial(value)).toBe(true);
    expect(redactSecretMaterial(value)).not.toContain('fixture-');
  });

  it('consumes bracket delimiters when redacting an explicit secret', () => {
    const value = 'api_key=[topsecret]';
    const redacted = redactSecretMaterial(value, ['topsecret']);

    expect(redacted).toBe('api_key=[REDACTED]');
    expect(containsSecretMaterial(value, ['topsecret'])).toBe(true);
    expect(containsSecretMaterial(redacted, ['topsecret'])).toBe(false);
    expect(redacted).not.toContain('topsecret');
  });

  it('keeps escaped nested JSON valid after redaction', () => {
    const value = '{"payload":"{\\"outer\\":{\\"token\\":\\"nested-secret\\"}}"}';
    const redacted = redactSecretMaterial(value);
    const parsed = JSON.parse(redacted);

    expect(parsed.payload).toBe('{"outer":{"token":"[REDACTED]"}}');
    expect(JSON.parse(parsed.payload).outer.token).toBe('[REDACTED]');
    expect(redacted).not.toContain('nested-secret');
  });

  it('preserves safe placeholders and does not classify them as secrets', () => {
    const value =
      '{"outer":{"token":"<redacted>","api_key":"[REDACTED]","password":"placeholder","authorization":"Bearer <redacted>"}}';

    expect(containsSecretMaterial(value)).toBe(false);
    expect(redactSecretMaterial(value)).toBe(value);
  });

  it('detects explicit secrets in JSON-shaped text and byte content', () => {
    const value = '{"credentials":{"apiKey":"fixture-secret"}}';

    expect(containsSecretMaterial(value, ['fixture-secret'])).toBe(true);
    expect(redactSecretMaterial(value, ['fixture-secret'])).toBe('{"credentials":{"apiKey":"[REDACTED]"}}');
    expect(containsSecretBytes(Buffer.from(value), ['fixture-secret'])).toBe(true);
  });
});
