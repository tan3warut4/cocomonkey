export class HttpError extends Error {
  constructor(
    public status: number,
    message: string,
    public detail?: unknown,
  ) {
    super(message);
  }
}

const enc = new TextEncoder();
const dec = new TextDecoder();

export function b64url(input: ArrayBuffer | Uint8Array | string): string {
  const bytes =
    typeof input === 'string' ? enc.encode(input) : input instanceof Uint8Array ? input : new Uint8Array(input);
  let bin = '';
  for (let i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i]);
  return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

export function b64urlToBytes(s: string) {
  const b64 = s.replace(/-/g, '+').replace(/_/g, '/') + '==='.slice((s.length + 3) % 4);
  const bin = atob(b64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

export function b64urlToString(s: string): string {
  return dec.decode(b64urlToBytes(s));
}

export function utf8(s: string) {
  return enc.encode(s);
}

/** Short random id with a readable prefix, e.g. "ST-k3j9x2". */
export function newId(prefix: string): string {
  const alphabet = 'abcdefghijkmnpqrstuvwxyz23456789';
  const bytes = crypto.getRandomValues(new Uint8Array(6));
  let s = '';
  for (const b of bytes) s += alphabet[b % alphabet.length];
  return `${prefix}-${s}`;
}

export function str(v: unknown): string {
  return v == null ? '' : String(v).trim();
}

export function num(v: unknown, fallback = 0): number {
  if (typeof v === 'number') return Number.isFinite(v) ? v : fallback;
  const n = parseFloat(str(v));
  return Number.isFinite(n) ? n : fallback;
}

export function bool(v: unknown, fallback = true): boolean {
  if (typeof v === 'boolean') return v;
  const s = str(v).toLowerCase();
  if (!s) return fallback;
  return ['true', '1', 'yes', 'y', 'ใช่', 'เปิด'].includes(s);
}

/** 1 -> A, 27 -> AA */
export function colLetter(n: number): string {
  let s = '';
  while (n > 0) {
    const m = (n - 1) % 26;
    s = String.fromCharCode(65 + m) + s;
    n = Math.floor((n - 1) / 26);
  }
  return s;
}
