/**
 * src/utils/sanitize.ts
 *
 * Input Sanitization & Injection Defense Utilities (OWASP A03:2021 – Injection)
 * Protects against:
 *  1. WhatsApp & Receipt Text Injection (Newline spoofing, BiDi direction flipping, Markdown breakout)
 *  2. HTML & Template Injection (XSS defense for web print & document generation)
 *  3. PostgREST ILIKE Wildcard Injection (% and _)
 *  4. Client-side input boundary & character restriction
 */

/**
 * Strips dangerous Unicode directional overrides and control characters.
 * Preserves standard Indic/regional script conjuncts (ZWJ/ZWNJ).
 * BiDi override codes (\u202A-\u202E, \u2066-\u2069) can visually reverse digits (e.g. ₹10000 -> 00001₹).
 */
export function stripBidiAndControlCodes(text: string): string {
  if (!text) return '';
  return text
    // Strip ASCII control characters except tab and newline (0x09, 0x0A, 0x0D handled separately)
    .replace(/[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]/g, '')
    // Strip BiDi overrides and isolates that spoof visual layout
    .replace(/[\u202A-\u202E\u2066-\u2069]/g, '');
}

/**
 * Escapes HTML special characters into safe HTML entities.
 * Prevents Stored XSS and HTML template injection during web print or PDF rendering.
 */
export function escapeHtml(text?: string | null): string {
  if (!text) return '';
  return String(text)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

/**
 * Sanitizes dynamic fields embedded into customer-facing text receipts (WhatsApp, SMS, Clipboard).
 * Prevents newline injection (fake invoice lines / spoofed grand totals) and
 * neutralizes WhatsApp markdown control characters (*, _, ~, `).
 */
export function sanitizeReceiptField(text?: string | null, maxLength = 80): string {
  if (!text) return '';
  let cleaned = stripBidiAndControlCodes(String(text));
  // Strip all newlines and carriage returns to prevent fake line injection
  cleaned = cleaned.replace(/[\r\n]+/g, ' ');
  // Neutralize WhatsApp markdown formatting characters
  cleaned = cleaned.replace(/[*_~`]/g, '');
  // Collapse whitespace
  cleaned = cleaned.replace(/\s+/g, ' ').trim();
  // Enforce max length
  if (cleaned.length > maxLength) {
    cleaned = cleaned.slice(0, maxLength);
  }
  return cleaned;
}

/**
 * Sanitizes customer names before database insertion and checkout processing.
 * Strips HTML tags, newlines, control codes, and enforces max length (80 chars).
 */
export function sanitizeCustomerName(name?: string | null): string {
  if (!name) return '';
  let cleaned = stripBidiAndControlCodes(String(name));
  // Strip HTML tags
  cleaned = cleaned.replace(/<[^>]*>/g, '');
  // Strip newlines
  cleaned = cleaned.replace(/[\r\n]+/g, ' ');
  // Collapse whitespace
  cleaned = cleaned.replace(/\s+/g, ' ').trim();
  // Length cap
  return cleaned.slice(0, 80);
}

/**
 * Sanitizes customer address for billing and CRM.
 * Allows clean multiline text (up to 2 consecutive newlines), strips HTML and control codes,
 * and caps at 250 characters.
 */
export function sanitizeAddress(address?: string | null): string {
  if (!address) return '';
  let cleaned = stripBidiAndControlCodes(String(address));
  // Strip HTML tags
  cleaned = cleaned.replace(/<[^>]*>/g, '');
  // Normalize carriage returns
  cleaned = cleaned.replace(/\r\n/g, '\n').replace(/\r/g, '\n');
  // Collapse excessive consecutive newlines (max 2)
  cleaned = cleaned.replace(/\n{3,}/g, '\n\n');
  // Collapse excessive spaces on same line
  cleaned = cleaned.replace(/[ \t]+/g, ' ').trim();
  // Length cap
  return cleaned.slice(0, 250);
}

/**
 * Sanitizes payment transaction references (UPI txn ref, cheque no, card auth).
 * Restricts to alphanumeric and standard safe payment punctuation ([A-Za-z0-9\-_/#. ]).
 * Caps at 50 characters.
 */
export function sanitizeTxnRef(ref?: string | null): string {
  if (!ref) return '';
  let cleaned = stripBidiAndControlCodes(String(ref));
  // Whitelist safe payment reference characters
  cleaned = cleaned.replace(/[^A-Za-z0-9\-_/#. ]/g, '');
  cleaned = cleaned.replace(/\s+/g, ' ').trim();
  return cleaned.slice(0, 50);
}

/**
 * Escapes SQL LIKE / ILIKE wildcards (% and _) for Supabase PostgREST queries.
 * Prevents wildcard injection where a user searching for '100%' matches everything.
 */
export function escapeLikeWildcards(str?: string | null): string {
  if (!str) return '';
  return String(str)
    .replace(/\\/g, '\\\\')
    .replace(/%/g, '\\%')
    .replace(/_/g, '\\_');
}
