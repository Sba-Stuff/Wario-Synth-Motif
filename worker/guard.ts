// SSRF guard for the MIDI proxy. Port of the checks in
// server/src/services/MIDIFetchService.ts, with three additions for the
// Worker runtime:
// - DNS is resolved over DoH (Workers have no dns.lookup);
// - IPv6 literals in brackets and IPv4-mapped IPv6 are checked;
// - each redirect hop is checked again (see fetchChecked).

type Check = { valid: true } | { valid: false; error: string };

const DOH = 'https://cloudflare-dns.com/dns-query';
const MAX_REDIRECTS = 5;

export async function validateTargetUrl(rawUrl: string): Promise<Check> {
  let parsed: URL;
  try {
    parsed = new URL(rawUrl);
  } catch {
    return { valid: false, error: 'Invalid URL' };
  }

  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    return { valid: false, error: 'Only http/https URLs are allowed' };
  }

  if (parsed.username || parsed.password) {
    return { valid: false, error: 'URLs with embedded credentials are not allowed' };
  }

  const hostname = parsed.hostname.trim().toLowerCase().replace(/^\[|\]$/g, '');
  if (!hostname) {
    return { valid: false, error: 'Missing hostname' };
  }

  if (isBlockedHostname(hostname)) {
    return { valid: false, error: 'Blocked hostname' };
  }

  // If hostname is a literal IP, validate directly.
  if (isIPv4(hostname) || hostname.includes(':')) {
    if (isPrivateOrLocalIp(hostname)) {
      return { valid: false, error: 'Blocked target IP' };
    }
    return { valid: true };
  }

  let resolved: string[];
  try {
    resolved = await resolve(hostname);
  } catch {
    return { valid: false, error: 'Unable to resolve hostname' };
  }
  if (resolved.length === 0) {
    return { valid: false, error: 'Unable to resolve hostname' };
  }

  // Require every resolved IP to be public routable.
  for (const ip of resolved) {
    if (isPrivateOrLocalIp(ip)) {
      return { valid: false, error: 'Blocked target IP' };
    }
  }

  return { valid: true };
}

// fetch() that follows redirects by hand so every hop passes the guard.
export async function fetchChecked(url: string, init: RequestInit): Promise<Response | { error: string }> {
  let current = url;
  for (let hop = 0; hop <= MAX_REDIRECTS; hop++) {
    const target = await validateTargetUrl(current);
    if (!target.valid) return { error: target.error };

    const response = await fetch(current, { ...init, redirect: 'manual' });
    const location = response.headers.get('location');
    if (response.status >= 300 && response.status < 400 && location) {
      current = new URL(location, current).href;
      continue;
    }
    return response;
  }
  return { error: 'Too many redirects' };
}

async function resolve(hostname: string): Promise<string[]> {
  const lookups = ['A', 'AAAA'].map(async (type) => {
    const res = await fetch(`${DOH}?name=${encodeURIComponent(hostname)}&type=${type}`, {
      headers: { accept: 'application/dns-json' },
    });
    if (!res.ok) throw new Error(`DoH ${res.status}`);
    const body = (await res.json()) as { Answer?: { type: number; data: string }[] };
    // Type 1 = A, 28 = AAAA. CNAME records in the chain are skipped.
    return (body.Answer ?? []).filter((a) => a.type === 1 || a.type === 28).map((a) => a.data);
  });
  return (await Promise.all(lookups)).flat();
}

function isBlockedHostname(hostname: string): boolean {
  return hostname === 'localhost' || hostname.endsWith('.localhost') || hostname.endsWith('.local');
}

function isIPv4(ip: string): boolean {
  return /^\d{1,3}(\.\d{1,3}){3}$/.test(ip);
}

function isPrivateOrLocalIp(ip: string): boolean {
  if (isIPv4(ip)) {
    return isPrivateOrLocalIPv4(ip);
  }
  if (ip.includes(':')) {
    return isPrivateOrLocalIPv6(ip);
  }
  return true;
}

function isPrivateOrLocalIPv4(ip: string): boolean {
  const parts = ip.split('.').map(Number);
  if (parts.length !== 4 || parts.some((n) => Number.isNaN(n) || n < 0 || n > 255)) {
    return true;
  }

  const [a, b] = parts;

  if (a === 10) return true;                     // 10.0.0.0/8
  if (a === 127) return true;                    // 127.0.0.0/8 loopback
  if (a === 0) return true;                      // 0.0.0.0/8 "this host"
  if (a === 169 && b === 254) return true;       // 169.254.0.0/16 link-local
  if (a === 172 && b >= 16 && b <= 31) return true; // 172.16.0.0/12
  if (a === 192 && b === 168) return true;       // 192.168.0.0/16
  if (a >= 224) return true;                     // multicast/reserved

  return false;
}

function isPrivateOrLocalIPv6(ip: string): boolean {
  const normalized = ip.toLowerCase();
  if (normalized === '::1') return true;         // loopback
  if (normalized === '::') return true;          // unspecified
  // IPv4-mapped (::ffff:a.b.c.d, or ::ffff:7f00:1 as the URL parser writes it)
  if (normalized.startsWith('::ffff:')) {
    const tail = normalized.slice(7);
    if (isIPv4(tail)) return isPrivateOrLocalIPv4(tail);
    const m = tail.match(/^([0-9a-f]{1,4}):([0-9a-f]{1,4})$/);
    if (!m) return true;
    const hi = parseInt(m[1], 16);
    const lo = parseInt(m[2], 16);
    return isPrivateOrLocalIPv4(`${hi >> 8}.${hi & 255}.${lo >> 8}.${lo & 255}`);
  }
  if (normalized.startsWith('fc') || normalized.startsWith('fd')) return true; // ULA fc00::/7
  if (normalized.startsWith('fe8') || normalized.startsWith('fe9') || normalized.startsWith('fea') || normalized.startsWith('feb')) {
    return true; // link-local fe80::/10
  }
  if (normalized.startsWith('ff')) return true;  // multicast ff00::/8
  return false;
}
