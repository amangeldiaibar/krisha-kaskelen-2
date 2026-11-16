import { describe, expect, it } from 'vitest';
import { countryByIso, countryOf, flagOf, formatNational, nationalOf, nationalPattern, phoneExample } from './phone.js';

const KZ = countryByIso('KZ');
const KG = countryByIso('KG');

function type(keys, country = KZ) {
  let value = '';
  for (const key of keys) value = formatNational(value + key, country, value);
  return value;
}

describe('formatNational', () => {
  it('groups digits as they are typed', () => {
    expect(type('7011112233')).toBe('701 111 22 33');
    expect(type('555123456', KG)).toBe('555 123 456');
  });

  it('accepts the 8 habit in +7 countries', () => {
    expect(type('87011112233')).toBe('701 111 22 33');
  });

  it('stops at a full number, whatever is typed', () => {
    expect(type('70111122334455667788')).toBe('701 111 22 33');
    expect(type('5551234567890', KG)).toBe('555 123 456');
  });

  it('drops the country code from pasted numbers', () => {
    expect(formatNational('87001234567', KZ)).toBe('700 123 45 67');
    expect(formatNational('77001234567', KZ)).toBe('700 123 45 67');
    expect(formatNational('7001234567', KZ)).toBe('700 123 45 67');
    expect(formatNational('+7 (700) 123-45-67', KZ)).toBe('700 123 45 67');
    expect(formatNational('+996 555 123 456', KG)).toBe('555 123 456');
    expect(formatNational('996555123456', KG)).toBe('555 123 456');
  });

  it('ignores letters and allows clearing', () => {
    expect(formatNational('abc', KZ)).toBe('');
    expect(formatNational('70a0', KZ)).toBe('700');
  });
});

describe('countries', () => {
  it('finds the country of a stored or half-typed number', () => {
    expect(countryOf('+996 555 123 456').iso).toBe('KG');
    expect(countryOf('+996 55').iso).toBe('KG');
    expect(countryOf('').iso).toBe('KZ');
    expect(countryOf('', 'TR').iso).toBe('TR');
  });

  it('tells Kazakhstan and Russia apart on +7, and keeps the chosen one while typing', () => {
    expect(countryOf('+7 700 123 45 67').iso).toBe('KZ');
    expect(countryOf('+7 912 123 45 67').iso).toBe('RU');
    expect(countryOf('+7 9', 'RU').iso).toBe('RU');
    expect(countryOf('+7 700 123 45 67', 'RU').iso).toBe('RU');
    expect(countryOf('+7 700 123 45 67', 'KG').iso).toBe('KZ');
  });

  it('builds the national part, pattern, example and flag', () => {
    expect(nationalOf('+996 555 123 456', KG)).toBe('555 123 456');
    expect(nationalOf('+7 700 1', KG)).toBe('');
    expect(new RegExp(`^${nationalPattern(KG)}$`).test('555 123 456')).toBe(true);
    expect(phoneExample(KZ)).toBe('+7 000 000 00 00');
    expect(flagOf('KZ')).toBe('🇰🇿');
  });
});
