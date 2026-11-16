import { COUNTRIES, DEFAULT_COUNTRY, countryByIso, groupDigits, nationalLength } from '../../shared/phones.js';

export { COUNTRIES, DEFAULT_COUNTRY, countryByIso };

/** The pattern a finished national number matches, such as "\d{3} \d{3} \d{2} \d{2}". */
export const nationalPattern = (country) => country.groups.map((size) => `\\d{${size}}`).join(' ');

/** A sample number with the country code, such as "+7 700 000 00 00" without the real digits. */
export const phoneExample = (country) => `+${country.code} ${country.groups.map((size) => '0'.repeat(size)).join(' ')}`;

/** The flag emoji for a two-letter country code. */
export const flagOf = (iso) => String.fromCodePoint(...[...iso].map((letter) => 0x1f1a5 + letter.charCodeAt(0)));

/**
 * Formats the part after the country code as it is typed or pasted, and stops at a full number.
 * `previous` is the current field value: once it is full, extra keys do nothing.
 */
export function formatNational(raw, country, previous = '') {
  const text = String(raw).trim();
  const length = nationalLength(country);
  let digits = text.replace(/\D/g, '');
  // Inside +7 countries people dial 8 first, so a number that starts with it gets one more digit.
  if (country.code === '7' && digits.length === length + 1 && digits[0] === '8') digits = digits.slice(1);
  else if (previous.replace(/\D/g, '').length === length && text.startsWith(previous)) return previous;
  // A pasted full number brings its country code.
  else if ((text.startsWith('+') || digits.length > length) && digits.startsWith(country.code)) digits = digits.slice(country.code.length);
  return groupDigits(digits.slice(0, length), country);
}

/**
 * The country a stored or half-typed value such as "+7 700 1" belongs to.
 * `chosen` is what the user picked. It wins when the value fits it, which matters
 * for an empty field and for the shared +7.
 */
export function countryOf(value, chosen = null) {
  const fits = COUNTRIES.filter((country) => value.startsWith(`+${country.code} `));
  if (fits.length === 0) return countryByIso(chosen ?? DEFAULT_COUNTRY);
  if (fits.some((country) => country.iso === chosen)) return countryByIso(chosen);
  const national = value.replace(/\D/g, '').slice(fits[0].code.length);
  return fits.find((country) => !country.national || country.national.test(national)) ?? fits[0];
}

/** The part of a value after its country code. */
export const nationalOf = (value, country) => (value.startsWith(`+${country.code} `) ? value.slice(country.code.length + 2) : '');
