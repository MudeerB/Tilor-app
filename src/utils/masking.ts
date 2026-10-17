/**
 * src/utils/masking.ts
 *
 * PII Masking & Data Protection Utilities (OWASP A02: Cryptographic Failures & PII Exposure)
 * Formats and masks customer phone numbers, GSTINs, and addresses for safe logging,
 * staff display, and compliance with Indian DPDPA regulations.
 */

/**
 * Masks a 10-digit Indian mobile number, displaying only the first 2 and last 4 digits.
 * Example: "9876543210" -> "98****3210"
 */
export function maskPhone(phone?: string | null): string {
  if (!phone) return '';
  const cleaned = phone.replace(/\D/g, '');
  let tenDigit = cleaned;
  if (cleaned.length === 12 && cleaned.startsWith('91')) {
    tenDigit = cleaned.slice(2);
  } else if (cleaned.length === 11 && cleaned.startsWith('0')) {
    tenDigit = cleaned.slice(1);
  }

  if (tenDigit.length === 10) {
    return `${tenDigit.slice(0, 2)}****${tenDigit.slice(6)}`;
  }
  if (cleaned.length > 6) {
    return `${cleaned.slice(0, 2)}****${cleaned.slice(-2)}`;
  }
  return phone;
}

/**
 * Masks a 15-character Indian GSTIN, obscuring PAN details.
 * Format: 2 State digits + 10 PAN chars + 3 Entity chars
 * Example: "29ABCDE1234F1Z5" -> "29******1234F1Z5"
 */
export function maskGstin(gstin?: string | null): string {
  if (!gstin) return '';
  const trimmed = gstin.trim();
  if (trimmed.length === 15) {
    return `${trimmed.slice(0, 2)}******${trimmed.slice(8)}`;
  }
  return trimmed;
}

/**
 * Truncates and sanitizes address for high-level summaries and logs.
 */
export function maskAddress(address?: string | null, maxLen = 20): string {
  if (!address) return '';
  const trimmed = address.trim();
  if (trimmed.length <= maxLen) return trimmed;
  return `${trimmed.slice(0, maxLen)}...`;
}
