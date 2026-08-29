import { describe, it, expect } from 'vitest';
import de from './de.json';
import en from './en.json';
import ptBR from './pt-BR.json';
import zhCN from './zh-CN.json';
import ja from './ja.json';
import es from './es.json';

function getAllKeys(obj: unknown, prefix = ''): string[] {
  if (typeof obj !== 'object' || obj === null) return [];
  return Object.entries(obj as Record<string, unknown>).flatMap(([key, value]) => {
    const fullKey = prefix ? `${prefix}.${key}` : key;
    if (value && typeof value === 'object' && !Array.isArray(value)) {
      return getAllKeys(value, fullKey);
    }
    return [fullKey];
  });
}

describe('Locale message keys consistency', () => {
  const locales = [
    { name: 'de', data: de },
    { name: 'en', data: en },
    { name: 'pt-BR', data: ptBR },
    { name: 'zh-CN', data: zhCN },
    { name: 'ja', data: ja },
    { name: 'es', data: es },
  ];

  const base = locales.find((locale) => locale.name === 'en');
  if (!base) throw new Error('Base locale not found');
  const baseKeys = getAllKeys(base.data);
  const legacyBase = locales.find((locale) => locale.name === 'de');
  if (!legacyBase) throw new Error('Legacy base locale not found');

  it('keeps the complete 543-key catalog contract', () => {
    expect(baseKeys).toHaveLength(543);
  });

  it(`should have the same keys as ${base.name} in es`, () => {
    expect(getAllKeys(es)).toEqual(baseKeys);
  });

  for (const locale of locales.filter(({ name }) => !['en', 'es'].includes(name))) {
    it(`should retain the legacy key shape in ${locale.name}`, () => {
      const localeKeys = getAllKeys(locale.data);
      expect(localeKeys).toEqual(getAllKeys(legacyBase.data));
    });
  }

  it('keeps the localized Gherkin template and keyword labels exact', () => {
    const expected = {
      de: {
        template: 'Angenommen / Wenn / Dann',
        given: 'Angenommen',
        when: 'Wenn',
        then: 'Dann',
        and: 'Und',
        but: 'Aber',
        background: 'Hintergrund',
        scenario: 'Szenario',
        examples: 'Beispiele',
      },
      en: {
        template: 'Given / When / Then',
        given: 'Given',
        when: 'When',
        then: 'Then',
        and: 'And',
        but: 'But',
        background: 'Background',
        scenario: 'Scenario',
        examples: 'Examples',
      },
      es: {
        template: 'Dado / Cuando / Entonces',
        given: 'Dado',
        when: 'Cuando',
        then: 'Entonces',
        and: 'Y',
        but: 'Pero',
        background: 'Antecedentes',
        scenario: 'Escenario',
        examples: 'Ejemplos',
      },
      'pt-BR': {
        template: 'Dado / Quando / Então',
        given: 'Dado',
        when: 'Quando',
        then: 'Então',
        and: 'E',
        but: 'Mas',
        background: 'Antecedentes',
        scenario: 'Cenário',
        examples: 'Exemplos',
      },
      'zh-CN': {
        template: '假如 / 当 / 那么',
        given: '假如',
        when: '当',
        then: '那么',
        and: '并且',
        but: '但是',
        background: '背景',
        scenario: '场景',
        examples: '示例',
      },
      ja: {
        template: '前提 / もし / ならば',
        given: '前提',
        when: 'もし',
        then: 'ならば',
        and: 'かつ',
        but: 'しかし',
        background: '背景',
        scenario: 'シナリオ',
        examples: '例',
      },
    };

    for (const locale of locales) {
      const catalog = locale.data as unknown as { Gherkin: (typeof expected)['en'] };
      expect(catalog.Gherkin).toEqual(expected[locale.name as keyof typeof expected]);
    }

    expect(es.Case.step).toBe('Pasos');
  });
});
