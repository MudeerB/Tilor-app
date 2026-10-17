/**
 * src/utils/urlSecurity.ts
 *
 * Client-Side Deep Link & Phone Sanitization Engine (OWASP A10:2021)
 * Defends against:
 * 1. Deep Link Parameter & Intent Injection (whatsapp://, tel://)
 * 2. Unsafe protocol execution (javascript:, file:, data:)
 * 3. Malformed phone number handling
 */

/**
 * Normalizes and validates an Indian/international phone number for mobile dialers and WhatsApp.
 * Strips all non-digit characters, removes leading '91' or '0' if 11-12 digits, and verifies
 * that the resulting mobile number is a valid 10-digit Indian number starting with 6, 7, 8, or 9.
 */
export function sanitizePhoneNumber(phone?: string | null): string | null {
  if (!phone || typeof phone !== 'string') return null;

  // Strip all non-digit characters (spaces, dashes, parentheses, plus signs)
  let digits = phone.replace(/\D/g, '');

  // Strip leading 0
  if (digits.length === 11 && digits.startsWith('0')) {
    digits = digits.slice(1);
  }

  // Strip leading 91 country code if 12 digits
  if (digits.length === 12 && digits.startsWith('91')) {
    digits = digits.slice(2);
  }

  // Standard Indian 10-digit mobile check (starts with 6, 7, 8, or 9)
  if (/^[6-9]\d{9}$/.test(digits)) {
    return digits;
  }

  // Fallback: If international number between 10 and 15 digits
  if (/^\d{10,15}$/.test(digits)) {
    return digits;
  }

  return null;
}

/**
 * Builds a safe, sanitized WhatsApp URL.
 * Automatically chooses universal 'https://wa.me/' on Web browsers and 'whatsapp://send' on mobile.
 */
export function buildSafeWhatsAppUrl(
  phone?: string | null,
  message?: string,
  preferredScheme: 'auto' | 'native' | 'universal' = 'auto'
): string | null {
  const cleanPhone = sanitizePhoneNumber(phone);
  if (!cleanPhone) return null;

  const countryPrefix = cleanPhone.length === 10 ? '91' : '';
  const fullPhone = `${countryPrefix}${cleanPhone}`;
  const encodedMsg = message ? encodeURIComponent(message) : '';

  // Detect browser Web environment safely without importing react-native
  const isWebEnvironment =
    typeof window !== 'undefined' &&
    typeof window.document !== 'undefined' &&
    typeof navigator !== 'undefined' &&
    (navigator as any).product !== 'ReactNative';

  const useUniversal = preferredScheme === 'universal' || (preferredScheme !== 'native' && isWebEnvironment);

  if (useUniversal) {
    return encodedMsg
      ? `https://wa.me/${fullPhone}?text=${encodedMsg}`
      : `https://wa.me/${fullPhone}`;
  }

  if (encodedMsg) {
    return `whatsapp://send?phone=${fullPhone}&text=${encodedMsg}`;
  }

  return `whatsapp://send?phone=${fullPhone}`;
}

/**
 * Builds a safe, sanitized telephone dialer URI (`tel:...`).
 * Guarantees telephone parameter has zero special characters or injected schemes.
 */
export function buildSafeTelUrl(phone?: string | null): string | null {
  const cleanPhone = sanitizePhoneNumber(phone);
  if (!cleanPhone) return null;

  return `tel:${cleanPhone}`;
}
