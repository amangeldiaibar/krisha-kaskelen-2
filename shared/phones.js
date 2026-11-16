// Phone formats shared by the site and the server.
// `groups` are the digit groups of a mobile number after the country code.
// Kazakhstan and Russia share +7, and `national` tells their numbers apart.
export const COUNTRIES = [
  { iso: 'KZ', code: '7', groups: [3, 3, 2, 2], national: /^[67]/ },
  { iso: 'RU', code: '7', groups: [3, 3, 2, 2], national: /^[349]/ },
  { iso: 'KG', code: '996', groups: [3, 3, 3] },
  { iso: 'UZ', code: '998', groups: [2, 3, 2, 2] },
  { iso: 'TJ', code: '992', groups: [2, 3, 2, 2] },
  { iso: 'TM', code: '993', groups: [2, 2, 2, 2] },
  { iso: 'AZ', code: '994', groups: [2, 3, 2, 2] },
  { iso: 'GE', code: '995', groups: [3, 2, 2, 2] },
  { iso: 'AM', code: '374', groups: [2, 3, 3] },
  { iso: 'BY', code: '375', groups: [2, 3, 2, 2] },
  { iso: 'UA', code: '380', groups: [2, 3, 2, 2] },
  { iso: 'MN', code: '976', groups: [4, 4] },
  { iso: 'CN', code: '86', groups: [3, 4, 4] },
  { iso: 'KR', code: '82', groups: [2, 4, 4] },
  { iso: 'TR', code: '90', groups: [3, 3, 2, 2] },
  { iso: 'AE', code: '971', groups: [2, 3, 4] },
  { iso: 'IN', code: '91', groups: [5, 5] },
  { iso: 'PK', code: '92', groups: [3, 7] },
  { iso: 'AF', code: '93', groups: [2, 3, 4] },
  { iso: 'GB', code: '44', groups: [4, 6] },
  { iso: 'US', code: '1', groups: [3, 3, 4] },
];

export const DEFAULT_COUNTRY = 'KZ';
export const countryByIso = (iso) => COUNTRIES.find((country) => country.iso === iso);
export const nationalLength = (country) => country.groups.reduce((sum, size) => sum + size, 0);

/** Splits national digits into the country's groups: "7001234567" becomes "700 123 45 67". */
export function groupDigits(digits, country) {
  const parts = [];
  let start = 0;
  for (const size of country.groups) {
    if (start >= digits.length) break;
    parts.push(digits.slice(start, start + size));
    start += size;
  }
  return parts.join(' ');
}

/**
 * Returns a full number of a listed country as "+7 700 000 00 00", or null.
 * Without a plus sign the number is read as a Kazakhstan one, with or without the 8 or 7 in front.
 */
export function normalizePhone(input) {
  const text = String(input ?? '').trim();
  let digits = text.replace(/\D/g, '');
  if (!text.startsWith('+')) {
    if (digits.length === 10) digits = `7${digits}`;
    else if (digits.length === 11 && digits[0] === '8') digits = `7${digits.slice(1)}`;
  }
  const country = COUNTRIES.find((item) => digits.startsWith(item.code) && digits.length === item.code.length + nationalLength(item));
  return country ? `+${country.code} ${groupDigits(digits.slice(country.code.length), country)}` : null;
}
