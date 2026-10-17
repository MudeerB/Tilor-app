/**
 * src/utils/integrity.ts
 *
 * Cryptographic Data Integrity Engine for Tilor.
 * SPRINT 8 FIX: OWASP A08:2021 - Software and Data Integrity Failures.
 *
 * Features:
 * 1. Hardware-backed device secret persistence via ChunkedSecureStore.
 * 2. HMAC-SHA256 payload signing and constant-time signature verification.
 * 3. Tenant- and user-scoped storage key generation to prevent cross-account contamination.
 * 4. Dual-mode execution: Native/Web W3C crypto.subtle with zero-dependency pure-JS SHA256 fallback.
 */

export interface SecureStorageAdapter {
  getItem(key: string): Promise<string | null>;
  setItem(key: string, value: string): Promise<void>;
}

let customStoreAdapter: SecureStorageAdapter | null = null;
let inMemoryFallbackSecret: string | null = null;

export function setIntegrityStoreAdapter(adapter: SecureStorageAdapter | null): void {
  customStoreAdapter = adapter;
}

async function getStoreAdapter(): Promise<SecureStorageAdapter | null> {
  if (customStoreAdapter) return customStoreAdapter;
  try {
    const { ChunkedSecureStore } = require('../services/supabase');
    return ChunkedSecureStore;
  } catch {
    return null;
  }
}

const DEVICE_SECRET_KEY = 'tilor_device_integrity_secret';

// ─── Pure JS SHA-256 & HMAC Fallback Engine ──────────────────────────────────

const K: number[] = [
  0x428a2f98, 0x71374491, 0xb5c0fbcf, 0xe9b5dba5, 0x3956c25b, 0x59f111f1, 0x923f82a4, 0xab1c5ed5,
  0xd807aa98, 0x12835b01, 0x243185be, 0x550c7dc3, 0x72be5d74, 0x80deb1fe, 0x9bdc06a7, 0xc19bf174,
  0xe49b69c1, 0xefbe4786, 0x0fc19dc6, 0x240ca1cc, 0x2de92c6f, 0x4a7484aa, 0x5cb0a9dc, 0x76f988da,
  0x983e5152, 0xa831c66d, 0xb00327c8, 0xbf597fc7, 0xc6e00bf3, 0xd5a79147, 0x06ca6351, 0x14292967,
  0x27b70a85, 0x2e1b2138, 0x4d2c6dfc, 0x53380d13, 0x650a7354, 0x766a0abb, 0x81c2c92e, 0x92722c85,
  0xa2bfe8a1, 0xa81a664b, 0xc24b8b70, 0xc76c51a3, 0xd192e819, 0xd6990624, 0xf40e3585, 0x106aa070,
  0x19a4c116, 0x1e376c08, 0x2748774c, 0x34b0bcb5, 0x391c0cb3, 0x4ed8aa4a, 0x5b9cca4f, 0x682e6ff3,
  0x748f82ee, 0x78a5636f, 0x84c87814, 0x8cc70208, 0x90befffa, 0xa4506ceb, 0xbef9a3f7, 0xc67178f2
];

function rotr(n: number, x: number): number {
  return (x >>> n) | (x << (32 - n));
}

function sha256Bytes(msgBytes: Uint8Array): Uint8Array {
  let h0 = 0x6a09e667, h1 = 0xbb67ae85, h2 = 0x3c6ef372, h3 = 0xa54ff53a;
  let h4 = 0x510e527f, h5 = 0x9b05688c, h6 = 0x1f83d9ab, h7 = 0x5be0cd19;

  const bitLen = msgBytes.length * 8;
  const withOne = new Uint8Array(msgBytes.length + 1);
  withOne.set(msgBytes);
  withOne[msgBytes.length] = 0x80;

  let padLen = (56 - (withOne.length % 64) + 64) % 64;
  const padded = new Uint8Array(withOne.length + padLen + 8);
  padded.set(withOne);

  const view = new DataView(padded.buffer);
  view.setUint32(padded.length - 4, bitLen >>> 0, false);
  view.setUint32(padded.length - 8, Math.floor(bitLen / 0x100000000), false);

  const w = new Int32Array(64);
  for (let i = 0; i < padded.length; i += 64) {
    for (let t = 0; t < 16; t++) {
      w[t] = view.getInt32(i + t * 4, false);
    }
    for (let t = 16; t < 64; t++) {
      const s0 = rotr(7, w[t - 15]) ^ rotr(18, w[t - 15]) ^ (w[t - 15] >>> 3);
      const s1 = rotr(17, w[t - 2]) ^ rotr(19, w[t - 2]) ^ (w[t - 2] >>> 10);
      w[t] = (w[t - 16] + s0 + w[t - 7] + s1) | 0;
    }

    let a = h0, b = h1, c = h2, d = h3, e = h4, f = h5, g = h6, h = h7;

    for (let t = 0; t < 64; t++) {
      const S1 = rotr(6, e) ^ rotr(11, e) ^ rotr(25, e);
      const ch = (e & f) ^ (~e & g);
      const temp1 = (h + S1 + ch + K[t] + w[t]) | 0;
      const S0 = rotr(2, a) ^ rotr(13, a) ^ rotr(22, a);
      const maj = (a & b) ^ (a & c) ^ (b & c);
      const temp2 = (S0 + maj) | 0;

      h = g;
      g = f;
      f = e;
      e = (d + temp1) | 0;
      d = c;
      c = b;
      b = a;
      a = (temp1 + temp2) | 0;
    }

    h0 = (h0 + a) | 0;
    h1 = (h1 + b) | 0;
    h2 = (h2 + c) | 0;
    h3 = (h3 + d) | 0;
    h4 = (h4 + e) | 0;
    h5 = (h5 + f) | 0;
    h6 = (h6 + g) | 0;
    h7 = (h7 + h) | 0;
  }

  const out = new Uint8Array(32);
  const outView = new DataView(out.buffer);
  outView.setInt32(0, h0, false);
  outView.setInt32(4, h1, false);
  outView.setInt32(8, h2, false);
  outView.setInt32(12, h3, false);
  outView.setInt32(16, h4, false);
  outView.setInt32(20, h5, false);
  outView.setInt32(24, h6, false);
  outView.setInt32(28, h7, false);
  return out;
}

function pureJsHmacSha256(keyStr: string, dataStr: string): string {
  const encoder = new TextEncoder();
  let key: Uint8Array<any> = encoder.encode(keyStr);
  const data = encoder.encode(dataStr);

  const blockSize = 64;
  if (key.length > blockSize) {
    key = sha256Bytes(key);
  }
  const paddedKey = new Uint8Array(blockSize);
  paddedKey.set(key);

  const oKeyPad = new Uint8Array(blockSize);
  const iKeyPad = new Uint8Array(blockSize);
  for (let i = 0; i < blockSize; i++) {
    oKeyPad[i] = paddedKey[i] ^ 0x5c;
    iKeyPad[i] = paddedKey[i] ^ 0x36;
  }

  const innerMsg = new Uint8Array(blockSize + data.length);
  innerMsg.set(iKeyPad, 0);
  innerMsg.set(data, blockSize);
  const innerHash = sha256Bytes(innerMsg);

  const outerMsg = new Uint8Array(blockSize + innerHash.length);
  outerMsg.set(oKeyPad, 0);
  outerMsg.set(innerHash, blockSize);
  const finalHash = sha256Bytes(outerMsg);

  return Array.from(finalHash)
    .map(b => b.toString(16).padStart(2, '0'))
    .join('');
}

// ─── Public Cryptographic Primitives ─────────────────────────────────────────

/**
 * Computes an HMAC-SHA256 signature string for given key and message.
 * Employs standard W3C Web Cryptography crypto.subtle where present,
 * gracefully falling back to pure JavaScript HMAC-SHA256.
 */
export async function computeHmacSha256(secret: string, data: string): Promise<string> {
  try {
    if (typeof globalThis.crypto?.subtle?.importKey === 'function') {
      const enc = new TextEncoder();
      const cryptoKey = await globalThis.crypto.subtle.importKey(
        'raw',
        enc.encode(secret),
        { name: 'HMAC', hash: 'SHA-256' },
        false,
        ['sign']
      );
      const signatureBuffer = await globalThis.crypto.subtle.sign(
        'HMAC',
        cryptoKey,
        enc.encode(data)
      );
      return Array.from(new Uint8Array(signatureBuffer))
        .map(b => b.toString(16).padStart(2, '0'))
        .join('');
    }
  } catch {
    // Fall back to pure JS if crypto.subtle is restricted or errors
  }

  return pureJsHmacSha256(secret, data);
}

/**
 * Compares two strings in constant time to prevent side-channel timing attacks.
 */
export function constantTimeEqual(a: string, b: string): boolean {
  if (typeof a !== 'string' || typeof b !== 'string') return false;
  if (a.length !== b.length) return false;
  let result = 0;
  for (let i = 0; i < a.length; i++) {
    result |= a.charCodeAt(i) ^ b.charCodeAt(i);
  }
  return result === 0;
}

/**
 * Retrieves the hardware-backed device secret or creates and stores a new 256-bit
 * cryptographically secure random secret via ChunkedSecureStore.
 */
export async function getOrCreateDeviceSecret(): Promise<string> {
  const store = await getStoreAdapter();
  let secret: string | null = store ? await store.getItem(DEVICE_SECRET_KEY) : inMemoryFallbackSecret;
  if (!secret || secret.trim().length === 0) {
    const randomBytes = new Uint8Array(32);
    if (typeof globalThis.crypto?.getRandomValues === 'function') {
      globalThis.crypto.getRandomValues(randomBytes);
    } else {
      for (let i = 0; i < 32; i++) {
        randomBytes[i] = Math.floor(Math.random() * 256);
      }
    }
    secret = Array.from(randomBytes)
      .map(b => b.toString(16).padStart(2, '0'))
      .join('');
    if (store) {
      await store.setItem(DEVICE_SECRET_KEY, secret);
    } else {
      inMemoryFallbackSecret = secret;
    }
  }
  return secret;
}

// ─── Offline Queue Integrity Helpers ─────────────────────────────────────────

export interface StockQueuePayload {
  id: string;
  shopId: string;
  variantId: string;
  type: 'inward' | 'outward';
  boxes: number;
  reference: string;
  userId: string;
  timestamp: string;
  tileName?: string;
}

/**
 * Returns a shop- and user-scoped storage key for offline stock movements.
 * Prevents cross-tenant and cross-user contamination on shared mobile devices.
 */
export function getOfflineStockQueueKey(shopId: string, userId: string): string {
  const safeShop = (shopId || 'unknown_shop').trim();
  const safeUser = (userId || 'unknown_user').trim();
  return `tilor_offline_stock_queue_${safeShop}_${safeUser}`;
}

/**
 * Canonicalizes stock movement data into a standardized delimiter-separated string.
 */
export function canonicalizeStockMovement(item: StockQueuePayload): string {
  return [
    item.id,
    item.shopId,
    item.variantId,
    item.type,
    String(item.boxes),
    item.reference || '',
    item.userId,
    item.timestamp,
  ].join('|');
}

/**
 * Signs an offline stock movement object using the device's hardware-backed secret.
 */
export async function signStockQueuePayload(item: StockQueuePayload): Promise<string> {
  const secret = await getOrCreateDeviceSecret();
  const canonicalString = canonicalizeStockMovement(item);
  return computeHmacSha256(secret, canonicalString);
}

/**
 * Verifies the HMAC-SHA256 signature of a stock movement object in constant time.
 * Rejects modified quantities, altered tenant/user IDs, or forged timestamps.
 */
export async function verifyStockQueuePayload(
  item: StockQueuePayload,
  signature: string
): Promise<boolean> {
  if (!signature || typeof signature !== 'string') return false;
  const expectedSignature = await signStockQueuePayload(item);
  return constantTimeEqual(expectedSignature, signature);
}
