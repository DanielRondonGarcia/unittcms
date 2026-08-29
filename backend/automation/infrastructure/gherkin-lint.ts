import { createRequire } from 'node:module';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

export type GherkinLintError = {
  line: number;
  rule: string;
  message: string;
};

export class GherkinLintUnavailableError extends Error {
  readonly code = 'gherkin_lint_unavailable';

  constructor() {
    super('gherkin_lint_unavailable');
    this.name = 'GherkinLintUnavailableError';
  }
}

type GherkinLintModule = {
  lint?: (files: string[], configuration: Readonly<Record<string, unknown>>) => Promise<unknown>;
};
type GherkinLintLoader = () => unknown;

const require = createRequire(import.meta.url);
const configuration = Object.freeze({
  'no-empty-background': 'on',
  'no-empty-file': 'on',
  'no-examples-in-scenarios': 'on',
  'no-files-without-scenarios': 'on',
  'no-scenario-outlines-without-examples': 'on',
  'no-trailing-spaces': 'on',
  'no-unnamed-features': 'on',
  'no-unnamed-scenarios': 'on',
  'no-unused-variables': 'on',
  'keywords-in-logical-order': 'on',
  'new-line-at-eof': ['on', 'yes'],
});

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object';
}

function safeText(value: unknown, maxLength: number): string {
  if (typeof value !== 'string') return '';
  return Array.from(value, (character) => {
    const code = character.charCodeAt(0);
    return code <= 0x1f || code === 0x7f ? ' ' : character;
  })
    .join('')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, maxLength);
}

function lintError(value: unknown): GherkinLintError | null {
  if (!isRecord(value)) return null;
  const candidate = value as Record<string, unknown>;
  const location = isRecord(candidate.location) ? candidate.location : undefined;
  const line = Number(candidate.line ?? location?.line);
  const rule = safeText(candidate.rule, 100);
  const message = safeText(candidate.message, 500);
  if (!Number.isSafeInteger(line) || line < 1 || line > 1_000_000 || !rule || !message) return null;
  return { line, rule, message };
}

function normalizeLintErrors(value: unknown, allowEmpty = false): GherkinLintError[] | null {
  const values = Array.isArray(value) ? value : isRecord(value) && Array.isArray(value.errors) ? value.errors : [value];
  if (values.length === 0) return allowEmpty ? [] : null;
  const errors = values.map(lintError);
  return errors.every((error): error is GherkinLintError => error !== null) ? errors : null;
}

function loadGherkinLint(): GherkinLintModule {
  return require('gherkin-lint/dist/linter.js') as GherkinLintModule;
}

export async function lintGherkinFeature(
  feature: string,
  loadLinter: GherkinLintLoader = loadGherkinLint
): Promise<GherkinLintError[]> {
  let directory: string | undefined;
  let lintErrors: GherkinLintError[] | undefined;
  let failure: unknown;

  try {
    directory = mkdtempSync(join(tmpdir(), 'unittcms-gherkin-lint-'));
    const file = join(directory, 'candidate.feature');
    writeFileSync(file, feature, 'utf8');

    const linter = loadLinter();
    if (!isRecord(linter) || typeof linter.lint !== 'function') throw new GherkinLintUnavailableError();

    let results: unknown;
    try {
      results = await linter.lint([file], configuration);
    } catch (error) {
      lintErrors = normalizeLintErrors(error) ?? undefined;
      if (!lintErrors) throw new GherkinLintUnavailableError();
    }

    if (!lintErrors) {
      if (
        !Array.isArray(results) ||
        results.length !== 1 ||
        !isRecord(results[0]) ||
        !Array.isArray(results[0].errors)
      ) {
        throw new GherkinLintUnavailableError();
      }
      lintErrors = normalizeLintErrors(results[0].errors, true) ?? undefined;
      if (!lintErrors) throw new GherkinLintUnavailableError();
    }
  } catch (error) {
    failure = error instanceof GherkinLintUnavailableError ? error : new GherkinLintUnavailableError();
  }

  if (directory) {
    try {
      rmSync(directory, { recursive: true, force: true });
    } catch {
      failure = new GherkinLintUnavailableError();
    }
  }

  if (failure) throw failure;
  return lintErrors ?? [];
}
