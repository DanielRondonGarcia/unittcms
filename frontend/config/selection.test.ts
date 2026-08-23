import { describe, expect, it } from 'vitest';
import { gherkinTemplate, templates } from './selection';

describe('case template selection', () => {
  it('appends Gherkin without changing persisted numeric values', () => {
    expect([gherkinTemplate, ...templates.map(({ uid }) => uid)]).toEqual([2, 'text', 'step', 'gherkin']);
  });
});
