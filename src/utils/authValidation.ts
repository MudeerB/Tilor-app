/**
 * src/utils/authValidation.ts
 *
 * Centralized password strength, complexity, and rotation lifecycle validation
 * adhering to OWASP A07:2021 (Identification & Authentication Failures).
 */

export interface PasswordValidationResult {
  isValid: boolean;
  hasMinLength: boolean;
  hasUppercase: boolean;
  hasLowercase: boolean;
  hasNumber: boolean;
  error?: string;
}

const MIN_PASSWORD_LENGTH = 8;
const MAX_PASSWORD_AGE_DAYS = 90;

/**
 * Validates password complexity:
 * - Minimum 8 characters
 * - At least 1 uppercase letter (A-Z)
 * - At least 1 lowercase letter (a-z)
 * - At least 1 number (0-9)
 */
export function validatePasswordStrength(password: string): PasswordValidationResult {
  const hasMinLength = (password || '').length >= MIN_PASSWORD_LENGTH;
  const hasUppercase = /[A-Z]/.test(password || '');
  const hasLowercase = /[a-z]/.test(password || '');
  const hasNumber = /[0-9]/.test(password || '');

  let error: string | undefined;
  if (!hasMinLength) {
    error = `Password must be at least ${MIN_PASSWORD_LENGTH} characters long.`;
  } else if (!hasUppercase) {
    error = 'Password must contain at least one uppercase letter (A-Z).';
  } else if (!hasLowercase) {
    error = 'Password must contain at least one lowercase letter (a-z).';
  } else if (!hasNumber) {
    error = 'Password must contain at least one number (0-9).';
  }

  return {
    isValid: hasMinLength && hasUppercase && hasLowercase && hasNumber,
    hasMinLength,
    hasUppercase,
    hasLowercase,
    hasNumber,
    error,
  };
}

/**
 * Checks if a staff password has expired based on a 90-day rotation policy.
 */
export function isPasswordExpired(
  passwordChangedAt: string | null | undefined,
  maxDays: number = MAX_PASSWORD_AGE_DAYS
): boolean {
  if (!passwordChangedAt) return false;
  const changedDate = new Date(passwordChangedAt).getTime();
  if (isNaN(changedDate)) return false;

  const ageMs = Date.now() - changedDate;
  const maxAgeMs = maxDays * 24 * 60 * 60 * 1000;
  return ageMs > maxAgeMs;
}

/**
 * Calculates remaining days before a password expires.
 * Returns negative numbers if already expired.
 */
export function daysUntilPasswordExpiry(
  passwordChangedAt: string | null | undefined,
  maxDays: number = MAX_PASSWORD_AGE_DAYS
): number {
  if (!passwordChangedAt) return maxDays;
  const changedDate = new Date(passwordChangedAt).getTime();
  if (isNaN(changedDate)) return maxDays;

  const ageMs = Date.now() - changedDate;
  const maxAgeMs = maxDays * 24 * 60 * 60 * 1000;
  const remainingMs = maxAgeMs - ageMs;
  return Math.ceil(remainingMs / (24 * 60 * 60 * 1000));
}
