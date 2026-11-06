import { describe, expect, it } from 'vitest';
import { messages, translate } from './i18n.js';

describe('translations', () => {
  it('has the same keys in every language', () => {
    const keys = Object.keys(messages.en).sort();
    expect(Object.keys(messages.ru).sort()).toEqual(keys);
    expect(Object.keys(messages.kk).sort()).toEqual(keys);
  });

  it('fills placeholders', () => {
    expect(translate('ru', 'distanceSdu', { n: 1.5 })).toBe('1.5 км до SDU по прямой');
  });
});
