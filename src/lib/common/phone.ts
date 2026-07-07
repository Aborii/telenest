/**
 * @file src/lib/common/phone.ts
 *
 * PURPOSE
 * -------
 * Shared phone-number masking so the library and its consumers redact numbers
 * the SAME way — a single privacy routine, and log lines that correlate (the
 * lib and an app logging the same login can't show two different masks).
 *
 * KEY EXPORTS
 * -----------
 * maskPhoneNumber — redacts all but the first 2 and last 2 characters.
 */

/**
 * Masks a phone number, keeping only the first 2 and last 2 characters and
 * replacing the middle with `*` (e.g. `+15551234567` → `+1********67`). A very
 * short value (≤ 4 chars) is fully masked. Never throws.
 *
 * @param phone - The phone number to mask (any format; not required to be E.164).
 * @returns The masked phone string.
 *
 * @example
 * ```ts
 * maskPhoneNumber('+15551234567'); // '+1********67'
 * ```
 */
export function maskPhoneNumber(phone: string): string {
  if (phone.length <= 4) return '*'.repeat(phone.length);
  const head = phone.slice(0, 2);
  const tail = phone.slice(-2);
  return `${head}${'*'.repeat(phone.length - 4)}${tail}`;
}
