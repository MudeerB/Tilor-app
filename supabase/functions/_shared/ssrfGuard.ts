/**
 * supabase/functions/_shared/ssrfGuard.ts
 *
 * Production-grade Server-Side Request Forgery (SSRF) Defense Engine (OWASP A10:2021)
 * Protects Supabase Edge Functions and outbound integration endpoints.
 */

export interface SsrfOptions {
  allowedDomains?: string[];
  allowHttpsOnly?: boolean;
  timeoutMs?: number;
  maxRedirects?: number;
}

export interface SsrfValidationResult {
  allowed: boolean;
  reason?: string;
  canonicalUrl?: string;
}

/**
 * Default safe domains allowed for Tilor outbound API integrations.
 */
export const DEFAULT_ALLOWED_DOMAINS = [
  'graph.facebook.com',
  'api.whatsapp.com',
  'whatsapp.com',
  '*.whatsapp.com',
];

/**
 * Parses various IPv4 representations (standard dotted, single dword integer, hex, octal).
 * Returns canonical 4-octet array [o1, o2, o3, o4] or null if not IPv4.
 */
export function parseIpv4ToOctets(host: string): [number, number, number, number] | null {
  if (!host) return null;

  // 1. Single integer/dword (e.g. 2130706433 or 0x7f000001)
  if (/^(?:0x[0-9a-fA-F]+|\d+)$/.test(host)) {
    const num = host.startsWith('0x') || host.startsWith('0X')
      ? parseInt(host, 16)
      : parseInt(host, 10);
    if (!isNaN(num) && num >= 0 && num <= 0xffffffff) {
      return [
        (num >>> 24) & 255,
        (num >>> 16) & 255,
        (num >>> 8) & 255,
        num & 255,
      ];
    }
  }

  // 2. Dotted notation (can be 1 to 4 parts with mixed decimal, hex, or octal)
  const parts = host.split('.');
  if (parts.length === 4) {
    const octets: number[] = [];
    for (const part of parts) {
      let val: number;
      if (/^0x[0-9a-fA-F]+$/i.test(part)) {
        val = parseInt(part, 16);
      } else if (/^0[0-7]+$/.test(part) && part !== '0') {
        val = parseInt(part, 8);
      } else if (/^\d+$/.test(part)) {
        val = parseInt(part, 10);
      } else {
        return null;
      }

      if (isNaN(val) || val < 0 || val > 255) {
        return null;
      }
      octets.push(val);
    }
    return [octets[0], octets[1], octets[2], octets[3]];
  }

  return null;
}

/**
 * Normalizes and checks if an IPv4 address belongs to private, loopback, or reserved subnets.
 */
export function isPrivateOrReservedIpv4(o: [number, number, number, number]): boolean {
  const [o1, o2, o3] = o;

  // 0.0.0.0/8 (Current network)
  if (o1 === 0) return true;

  // 127.0.0.0/8 (Loopback)
  if (o1 === 127) return true;

  // 10.0.0.0/8 (RFC 1918 Private)
  if (o1 === 10) return true;

  // 172.16.0.0/12 (RFC 1918 Private: 172.16.0.0 - 172.31.255.255)
  if (o1 === 172 && o2 >= 16 && o2 <= 31) return true;

  // 192.168.0.0/16 (RFC 1918 Private)
  if (o1 === 192 && o2 === 168) return true;

  // 169.254.0.0/16 (Link-Local & Cloud Metadata e.g. 169.254.169.254)
  if (o1 === 169 && o2 === 254) return true;

  // 100.64.0.0/10 (Carrier-Grade NAT: 100.64.0.0 - 100.127.255.255)
  if (o1 === 100 && o2 >= 64 && o2 <= 127) return true;

  // 192.0.0.0/24 (IETF Protocol Assignments)
  if (o1 === 192 && o2 === 0 && o3 === 0) return true;

  // 192.0.2.0/24 (TEST-NET-1)
  if (o1 === 192 && o2 === 0 && o3 === 2) return true;

  // 198.51.100.0/24 (TEST-NET-2)
  if (o1 === 198 && o2 === 51 && o3 === 100) return true;

  // 203.0.113.0/24 (TEST-NET-3)
  if (o1 === 203 && o2 === 0 && o3 === 113) return true;

  // 224.0.0.0/4 (Multicast: 224 - 239)
  if (o1 >= 224 && o1 <= 239) return true;

  // 240.0.0.0/4 (Reserved / Broadcast: 240 - 255)
  if (o1 >= 240) return true;

  return false;
}

/**
 * Checks if an IPv6 address string is loopback, unique local, or link-local.
 */
export function isPrivateOrReservedIpv6(host: string): boolean {
  let cleaned = host.toLowerCase().trim();
  if (cleaned.startsWith('[') && cleaned.endsWith(']')) {
    cleaned = cleaned.slice(1, -1);
  }

  // IPv4-mapped IPv6 (::ffff:127.0.0.1 or ::ffff:7f00:1)
  if (cleaned.startsWith('::ffff:')) {
    const mappedIpv4 = cleaned.replace(/^::ffff:/, '');
    const octets = parseIpv4ToOctets(mappedIpv4);
    if (octets) {
      return isPrivateOrReservedIpv4(octets);
    }
    return true; // Malformed mapped v6 is unsafe
  }

  // Loopback (::1) and Unspecified (::)
  if (cleaned === '::1' || cleaned === '::' || /^0*(?::0*)*:0*1$/.test(cleaned)) {
    return true;
  }

  // Unique Local (fc00::/7 -> fc.. or fd..)
  if (/^f[cd][0-9a-f]{2}:/i.test(cleaned)) {
    return true;
  }

  // Link-Local (fe80::/10 -> fe8, fe9, fea, feb)
  if (/^fe[89ab][0-9a-f]:/i.test(cleaned)) {
    return true;
  }

  // Multicast (ff00::/8)
  if (/^ff[0-9a-f]{2}:/i.test(cleaned)) {
    return true;
  }

  return false;
}

/**
 * Verifies if a hostname matches an allowlisted domain list with wildcard support.
 */
export function isAllowlistedDomain(hostname: string, allowedDomains: string[]): boolean {
  const host = hostname.toLowerCase().trim();

  for (const pattern of allowedDomains) {
    const pat = pattern.toLowerCase().trim();
    if (pat.startsWith('*.')) {
      const suffix = pat.slice(2);
      if (host === suffix || host.endsWith('.' + suffix)) {
        return true;
      }
    } else if (host === pat) {
      return true;
    }
  }

  return false;
}

/**
 * Validates any outbound URL candidate for SSRF vulnerabilities before fetching.
 */
export function validateUrlForSsrf(
  urlStr: string,
  options: SsrfOptions = {}
): SsrfValidationResult {
  const {
    allowedDomains,
    allowHttpsOnly = true,
  } = options;

  if (!urlStr || typeof urlStr !== 'string') {
    return { allowed: false, reason: 'URL must be a non-empty string.' };
  }

  let parsed: URL;
  try {
    parsed = new URL(urlStr);
  } catch {
    return { allowed: false, reason: 'Malformed URL syntax.' };
  }

  // 1. Protocol / Scheme Check
  const protocol = parsed.protocol.toLowerCase();
  if (allowHttpsOnly) {
    if (protocol !== 'https:') {
      return { allowed: false, reason: `Insecure protocol '${protocol}'. Only 'https:' is permitted.` };
    }
  } else {
    if (protocol !== 'https:' && protocol !== 'http:') {
      return { allowed: false, reason: `Disallowed protocol '${protocol}'. Only HTTP(S) permitted.` };
    }
  }

  // 2. Prohibit embedded credentials (e.g. https://user:pass@domain.com/)
  if (parsed.username || parsed.password) {
    return { allowed: false, reason: 'URL cannot contain embedded authentication credentials.' };
  }

  // 3. Port check (standard ports only: 80, 443, or empty)
  if (parsed.port && parsed.port !== '80' && parsed.port !== '443') {
    return { allowed: false, reason: `Disallowed outbound port '${parsed.port}'. Only standard web ports (80, 443) allowed.` };
  }

  const hostname = parsed.hostname.toLowerCase().trim();

  // 4. Special hostnames & Cloud Metadata DNS aliases
  const dangerousHostnames = [
    'localhost',
    'metadata.google.internal',
    'metadata.google',
    'instance-data',
    '169.254.169.254',
  ];
  if (dangerousHostnames.includes(hostname) || hostname.endsWith('.localhost')) {
    return { allowed: false, reason: `Host '${hostname}' is a reserved internal or metadata service.` };
  }

  // 5. Check if hostname is an IPv4 address (or obfuscated numeric IP)
  const ipv4Octets = parseIpv4ToOctets(hostname);
  if (ipv4Octets) {
    if (isPrivateOrReservedIpv4(ipv4Octets)) {
      return { allowed: false, reason: `IP address '${ipv4Octets.join('.')}' is a private, loopback, or cloud-metadata network.` };
    }
    // If strict domain allowlist is enforced, raw IPs without explicit domain allowlist are rejected
    if (allowedDomains && allowedDomains.length > 0) {
      return { allowed: false, reason: `Raw IP access '${hostname}' is prohibited when domain allowlist is active.` };
    }
  }

  // 6. Check if hostname is an IPv6 address
  if (hostname.includes(':') || hostname.startsWith('[')) {
    if (isPrivateOrReservedIpv6(hostname)) {
      return { allowed: false, reason: `IPv6 address '${hostname}' is a loopback or private network.` };
    }
    if (allowedDomains && allowedDomains.length > 0) {
      return { allowed: false, reason: `Raw IPv6 access '${hostname}' is prohibited when domain allowlist is active.` };
    }
  }

  // 7. Domain Allowlist Check (if configured)
  if (allowedDomains && allowedDomains.length > 0) {
    if (!isAllowlistedDomain(hostname, allowedDomains)) {
      return { allowed: false, reason: `Domain '${hostname}' is not in the authorized outbound allowlist.` };
    }
  }

  return {
    allowed: true,
    canonicalUrl: parsed.toString(),
  };
}

/**
 * Safe fetch wrapper that intercepts outbound HTTP requests, enforces SSRF checks,
 * sets connection timeouts, and safely evaluates redirects to prevent Open Redirect SSRF.
 */
export async function safeFetch(
  urlStr: string,
  init: RequestInit = {},
  options: SsrfOptions = {}
): Promise<Response> {
  const {
    timeoutMs = 5000,
    maxRedirects = 3,
    ...ssrfOpts
  } = options;

  let currentUrl = urlStr;
  let redirectsCount = 0;

  while (redirectsCount <= maxRedirects) {
    // 1. SSRF pre-flight validation
    const validation = validateUrlForSsrf(currentUrl, ssrfOpts);
    if (!validation.allowed) {
      throw new Error(`[SSRF Defense Blocked] ${validation.reason} (Target: ${currentUrl})`);
    }

    // 2. AbortController for timeout protection
    const controller = new AbortController();
    const timeoutHandle = setTimeout(() => controller.abort(), timeoutMs);

    try {
      // Always use manual redirect handling to inspect Location header
      const fetchResponse = await fetch(currentUrl, {
        ...init,
        redirect: 'manual',
        signal: controller.signal,
      });

      clearTimeout(timeoutHandle);

      // Check if this is a redirect status
      const status = fetchResponse.status;
      if ([301, 302, 303, 307, 308].includes(status)) {
        redirectsCount++;
        if (redirectsCount > maxRedirects) {
          throw new Error(`[SSRF Defense Blocked] Exceeded maximum allowed redirects (${maxRedirects}).`);
        }

        const location = fetchResponse.headers.get('location');
        if (!location) {
          throw new Error('[SSRF Defense Blocked] Received redirect status without Location header.');
        }

        // Resolve relative redirects safely against currentUrl
        const resolvedRedirectUrl = new URL(location, currentUrl).toString();
        currentUrl = resolvedRedirectUrl;
        continue;
      }

      return fetchResponse;
    } catch (err: any) {
      clearTimeout(timeoutHandle);
      if (err.name === 'AbortError') {
        throw new Error(`[SSRF Defense Blocked] Outbound request timed out after ${timeoutMs}ms.`);
      }
      throw err;
    }
  }

  throw new Error(`[SSRF Defense Blocked] Too many redirects.`);
}
