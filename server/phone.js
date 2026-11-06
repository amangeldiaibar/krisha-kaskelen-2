/** Returns a Kazakhstan number as "+7 700 000 00 00", or null when it is not one. */
export function normalizePhone(input) {
  let digits = String(input ?? '').replace(/\D/g, '');
  if (digits.length === 10) digits = `7${digits}`;
  if (digits.length !== 11 || !/^[78]/.test(digits)) return null;
  const rest = digits.slice(1);
  return `+7 ${rest.slice(0, 3)} ${rest.slice(3, 6)} ${rest.slice(6, 8)} ${rest.slice(8)}`;
}
