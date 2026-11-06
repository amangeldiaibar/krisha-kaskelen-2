export const PHONE_PREFIX = '+7';
export const PHONE_FULL_LENGTH = 16;
export const PHONE_PATTERN = '\\+7 \\d{3} \\d{3} \\d{2} \\d{2}';

/**
 * Formats what is typed or pasted and stops at a full Kazakhstan number.
 * `previous` is the current field value: once it is full, extra keys do nothing.
 */
export function formatPhoneInput(raw, previous = '') {
  const text = String(raw).trim();
  if (previous.length === PHONE_FULL_LENGTH && text.startsWith(previous)) return previous;

  let digits = text.replace(/\D/g, '');
  if (!digits) return '';
  if (text.startsWith(PHONE_PREFIX)) {
    // The field already shows +7, so these digits belong to the number itself.
    digits = digits.slice(1);
    if (digits[0] === '8' || (digits[0] === '7' && digits.length === 11)) digits = digits.slice(1);
  } else if (digits[0] === '8' || (digits[0] === '7' && (digits.length === 1 || digits.length >= 11))) {
    digits = digits.slice(1);
  }

  digits = digits.slice(0, 10);
  const parts = [digits.slice(0, 3), digits.slice(3, 6), digits.slice(6, 8), digits.slice(8, 10)].filter(Boolean);
  return [PHONE_PREFIX, ...parts].join(' ');
}
