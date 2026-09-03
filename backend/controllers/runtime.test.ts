import { spawnSync } from 'node:child_process';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const backendDirectory = resolve(dirname(fileURLToPath(import.meta.url)), '..');

describe('controller ESM runtime loading', () => {
  it('loads all TSOA controllers through the Node.js and tsx boundary', () => {
    const result = spawnSync(
      process.execPath,
      [
        '--import',
        'tsx',
        '--input-type=module',
        '--eval',
        [
          'const [{ IndexController }, { HealthController }, { AutomationController }] = await Promise.all([',
          "  import('./controllers/IndexController.ts'),",
          "  import('./controllers/HealthController.ts'),",
          "  import('./controllers/AutomationController.ts'),",
          ']);',
          "if (![IndexController, HealthController, AutomationController].every((controller) => typeof controller === 'function')) process.exit(1);",
        ].join('\n'),
      ],
      {
        cwd: backendDirectory,
        encoding: 'utf8',
        timeout: 10_000,
      }
    );

    const diagnostics = [result.stdout, result.stderr, result.error?.message].filter(Boolean).join('\n');
    expect(result.error, diagnostics).toBeUndefined();
    expect(result.status, diagnostics).toBe(0);
  });
});
