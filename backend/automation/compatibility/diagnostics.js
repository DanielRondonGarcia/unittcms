const REDACTED = '[REDACTED]';
const SENSITIVE_KEY_SOURCE = String.raw`(?:password|passwd|passphrase|secret(?:[_ -]?value)?|(?:x[_ -]?)?api[_ -]?key|authorization|(?:access|refresh|id|auth)[_ -]?token|client[_ -]?secret|token(?:[_ -]?value)?|bearer)`;
const QUOTED_VALUE = String.raw`(?:(?:\\)?"(?:\\.|[^"\\])*(?:\\)?"|(?:\\)?'(?:\\.|[^'\\])*(?:\\)?')`;
const BRACKETED_VALUE = String.raw`\[(?:[^\[\]\r\n]|\[[^\[\]\r\n]*\]){0,256}\]`;
const SAFE_PLACEHOLDER_SOURCE = String.raw`(?:<[^>\r\n]{0,256}>|\[redacted\]|redacted|placeholder|replace[-_ ]?me|null|none|undefined|n\/a|\*+|x+)`;
const SAFE_BEARER_VALUE = String.raw`Bearer[ \t]+${SAFE_PLACEHOLDER_SOURCE}`;
const FIELD_VALUE = String.raw`(?:${QUOTED_VALUE}|${SAFE_BEARER_VALUE}|${BRACKETED_VALUE}|[^\s,;}\]\)]+)`;
const SENSITIVE_FIELD_PATTERN = new RegExp(
  String.raw`((?:(?:\\)?["'])?\b${SENSITIVE_KEY_SOURCE}\b(?:(?:\\)?["'])?\s*[:=]\s*)(${FIELD_VALUE})`,
  'gi'
);
const BEARER_PATTERN = new RegExp(
  String.raw`\bBearer[ \t]+(?!["']?${SAFE_PLACEHOLDER_SOURCE}["']?)(?:${QUOTED_VALUE}|${BRACKETED_VALUE}|[^\s"',;}\]\)]+)`,
  'gi'
);
const OPENAI_KEY_PATTERN = /\bsk-[A-Za-z0-9_-]{12,}\b/g;
const PLACEHOLDER_PATTERN =
  /^(?:<[^>]+>|\[redacted\]|redacted|placeholder|replace[-_ ]?me|null|none|undefined|n\/a|\*+|x+|bearer)$/i;
const SENSITIVE_JSON_KEYS = new Set([
  'password',
  'passwd',
  'passphrase',
  'secret',
  'secretvalue',
  'apikey',
  'xapikey',
  'authorization',
  'accesstoken',
  'refreshtoken',
  'idtoken',
  'authtoken',
  'clientsecret',
  'token',
  'tokenvalue',
  'bearer',
]);
const MAX_JSON_REDACTION_DEPTH = 32;

function normalizePlaceholder(value) {
  return String(value ?? '')
    .trim()
    .replace(/^(?:\\)?["']/, '')
    .replace(/(?:\\)?["']$/, '')
    .trim();
}

function isSafePlaceholder(value) {
  const normalized = normalizePlaceholder(value);
  if (!normalized || PLACEHOLDER_PATTERN.test(normalized)) return true;
  return /^Bearer\s+(?:<[^>]+>|\[redacted\]|redacted|placeholder|replace[-_ ]?me|null|none|undefined|n\/a|\*+|x+)$/i.test(
    normalized
  );
}

function quotedParts(value) {
  const pairs = [
    ['\\"', '\\"'],
    ['"', '"'],
    ["\\'", "\\'"],
    ["'", "'"],
  ];
  for (const [opening, closing] of pairs) {
    if (value.startsWith(opening) && value.endsWith(closing) && value.length >= opening.length + closing.length)
      return { opening, closing, content: value.slice(opening.length, value.length - closing.length) };
  }
  return null;
}

function valueContent(value) {
  return quotedParts(value)?.content ?? value.trim();
}

function redactedValue(value) {
  const parts = quotedParts(value);
  return parts ? `${parts.opening}${REDACTED}${parts.closing}` : REDACTED;
}

function replaceExplicitSecrets(value, secretValues) {
  let result = value;
  let changed = false;
  for (const secret of secretValues
    .filter((candidate) => typeof candidate === 'string' && candidate)
    .sort((left, right) => right.length - left.length)) {
    const next = result.split(secret).join(REDACTED);
    changed ||= next !== result;
    result = next;
  }
  return { value: result, changed };
}

function redactText(value, secretValues) {
  let result = replaceExplicitSecrets(value, secretValues);
  let changed = result.changed;

  result = {
    value: result.value.replace(BEARER_PATTERN, (match) => {
      changed = true;
      const prefix = /^Bearer([ \t]+)(.*)$/i.exec(match);
      return prefix ? `Bearer${prefix[1]}${redactedValue(prefix[2])}` : `Bearer ${REDACTED}`;
    }),
    changed,
  };
  result = {
    value: result.value.replace(SENSITIVE_FIELD_PATTERN, (match, prefix, rawValue) => {
      if (isSafePlaceholder(valueContent(rawValue))) return match;
      changed = true;
      return `${prefix}${redactedValue(rawValue)}`;
    }),
    changed,
  };
  result = {
    value: result.value.replace(OPENAI_KEY_PATTERN, () => {
      changed = true;
      return REDACTED;
    }),
    changed,
  };
  return result;
}

function parseJsonDocument(value) {
  const trimmed = value.trim();
  if (!trimmed || (!trimmed.startsWith('{') && !trimmed.startsWith('['))) return null;
  try {
    const start = value.indexOf(trimmed);
    return {
      value: JSON.parse(trimmed),
      leading: value.slice(0, start),
      trailing: value.slice(start + trimmed.length),
    };
  } catch {
    return null;
  }
}

function compactKey(value) {
  return value.replace(/[\s_-]/g, '').toLowerCase();
}

function isSensitiveJsonKey(value) {
  return SENSITIVE_JSON_KEYS.has(compactKey(value));
}

function safeJsonSecretValue(value) {
  return value === null || (typeof value === 'string' && isSafePlaceholder(value));
}

function sanitizeJsonValue(value, secretValues, depth) {
  if (depth > MAX_JSON_REDACTION_DEPTH) return { value: REDACTED, changed: true };
  if (typeof value === 'string') {
    const nested = parseJsonDocument(value);
    if (nested) {
      const sanitizedNested = sanitizeJsonValue(nested.value, secretValues, depth + 1);
      if (sanitizedNested.changed)
        return {
          value: `${nested.leading}${JSON.stringify(sanitizedNested.value)}${nested.trailing}`,
          changed: true,
        };
    }
    return redactText(value, secretValues);
  }
  if (Array.isArray(value)) {
    let changed = false;
    const result = value.map((item) => {
      const sanitized = sanitizeJsonValue(item, secretValues, depth + 1);
      changed ||= sanitized.changed;
      return sanitized.value;
    });
    return { value: result, changed };
  }
  if (!value || typeof value !== 'object') return { value, changed: false };

  let changed = false;
  const result = {};
  for (const [key, item] of Object.entries(value)) {
    const redactedKey = replaceExplicitSecrets(key, secretValues);
    const outputKey = redactedKey.value;
    changed ||= redactedKey.changed;
    if (isSensitiveJsonKey(key)) {
      if (safeJsonSecretValue(item)) {
        result[outputKey] = item;
      } else {
        result[outputKey] = REDACTED;
        changed = true;
      }
      continue;
    }
    const sanitized = sanitizeJsonValue(item, secretValues, depth + 1);
    changed ||= sanitized.changed;
    result[outputKey] = sanitized.value;
  }
  return { value: result, changed };
}

/**
 * @param {string} value
 * @param {readonly string[]} [secretValues]
 */
export function containsSecretMaterial(value, secretValues = []) {
  if (typeof value !== 'string') return false;
  const document = parseJsonDocument(value);
  return document
    ? sanitizeJsonValue(document.value, secretValues, 0).changed
    : redactText(value, secretValues).changed;
}

/**
 * @param {Uint8Array} bytes
 * @param {readonly string[]} [secretValues]
 */
export function containsSecretBytes(bytes, secretValues = []) {
  const value = Buffer.from(bytes);
  return (
    containsSecretMaterial(value.toString('latin1')) ||
    secretValues.some((secret) => typeof secret === 'string' && secret && value.includes(Buffer.from(secret, 'utf8')))
  );
}

/**
 * @param {string} value
 * @param {readonly string[]} [secretValues]
 */
export function redactSecretMaterial(value, secretValues = []) {
  const source = String(value ?? '');
  const document = parseJsonDocument(source);
  if (document) {
    const sanitized = sanitizeJsonValue(document.value, secretValues, 0);
    if (sanitized.changed) return `${document.leading}${JSON.stringify(sanitized.value)}${document.trailing}`;
    return source;
  }
  return redactText(source, secretValues).value;
}
