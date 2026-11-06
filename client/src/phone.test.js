import { describe, expect, it } from 'vitest';
import { formatPhoneInput } from './phone.js';

function type(keys, start = '+7') {
  let value = start;
  for (const key of keys) value = formatPhoneInput(value + key, value);
  return value;
}

describe('formatPhoneInput', () => {
  it('keeps a first 7 typed after the prefix, because mobile codes start with it', () => {
    expect(type('7011112233')).toBe('+7 701 111 22 33');
  });

  it('accepts the 8 habit', () => {
    expect(type('87011112233')).toBe('+7 701 111 22 33');
  });

  it('stops at a full number, whatever is typed', () => {
    expect(type('70111122334455667788')).toBe('+7 701 111 22 33');
  });

  it('formats pasted numbers in common forms', () => {
    expect(formatPhoneInput('87001234567')).toBe('+7 700 123 45 67');
    expect(formatPhoneInput('77001234567')).toBe('+7 700 123 45 67');
    expect(formatPhoneInput('7001234567')).toBe('+7 700 123 45 67');
    expect(formatPhoneInput('+7 (700) 123-45-67')).toBe('+7 700 123 45 67');
    expect(formatPhoneInput('+7+77001234567')).toBe('+7 700 123 45 67');
    expect(formatPhoneInput('1'.repeat(500))).toBe('+7 111 111 11 11');
  });

  it('ignores letters and allows clearing', () => {
    expect(formatPhoneInput('abc')).toBe('');
    expect(formatPhoneInput('+')).toBe('');
    expect(formatPhoneInput('+7 70a0')).toBe('+7 700');
  });
});
