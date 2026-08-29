import { describe, expect, it, vi } from 'vitest';
import { lintGherkinFeature } from './gherkin-lint.js';

const feature = `Feature: Login

  Scenario: Login
    Given the user is signed out
    When the user signs in
    Then the dashboard is shown
`;

describe('Gherkin lint adapter', () => {
  it('returns no errors for a valid linter result', async () => {
    const lint = vi.fn(async () => [{ filePath: 'candidate.feature', errors: [] }]);

    await expect(lintGherkinFeature(feature, () => ({ lint }))).resolves.toEqual([]);
    expect(lint).toHaveBeenCalledWith(
      [expect.stringMatching(/candidate\.feature$/)],
      expect.objectContaining({ 'no-unnamed-features': 'on' })
    );
  });

  it('returns sanitized and bounded rule failures', async () => {
    const lint = vi.fn(async () => [
      {
        filePath: 'candidate.feature',
        errors: [
          {
            line: '4',
            rule: ' no-trailing-spaces ',
            message: `Trailing spaces are not allowed\n${'x'.repeat(600)}`,
          },
        ],
      },
    ]);

    const errors = await lintGherkinFeature(feature, () => ({ lint }));

    expect(errors).toHaveLength(1);
    expect(errors[0]).toMatchObject({ line: 4, rule: 'no-trailing-spaces' });
    expect(errors[0].message).not.toContain('\n');
    expect(errors[0].message).not.toContain('\u0000');
    expect(errors[0].message.length).toBeLessThanOrEqual(500);
  });

  it('preserves structured parse failures rejected by the linter', async () => {
    const lint = vi.fn(async () => {
      throw [{ line: '9', rule: 'unexpected-error', message: 'Expected a Scenario\nnear the end' }];
    });

    await expect(lintGherkinFeature(feature, () => ({ lint }))).resolves.toEqual([
      { line: 9, rule: 'unexpected-error', message: 'Expected a Scenario near the end' },
    ]);
  });

  it('reports an unavailable module or API separately from lint failures', async () => {
    await expect(lintGherkinFeature(feature, () => ({ lint: undefined }))).rejects.toMatchObject({
      code: 'gherkin_lint_unavailable',
      message: 'gherkin_lint_unavailable',
    });
  });
});
