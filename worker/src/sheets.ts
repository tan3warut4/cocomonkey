import type { Env } from './env';
import { HttpError, b64url, utf8 } from './util';

// ---------- Google service-account auth (RS256 JWT -> access token) ----------

interface ServiceAccount {
  client_email: string;
  private_key: string;
}

let saCache: { raw: string; sa: ServiceAccount; key: Promise<CryptoKey> } | null = null;
let tokenCache: { token: string; exp: number } | null = null;

function serviceAccount(env: Env): { sa: ServiceAccount; key: Promise<CryptoKey> } {
  if (saCache && saCache.raw === env.GOOGLE_SA_JSON) return saCache;
  let sa: ServiceAccount;
  try {
    sa = JSON.parse(env.GOOGLE_SA_JSON);
  } catch {
    throw new HttpError(500, 'GOOGLE_SA_JSON ไม่ใช่ JSON ที่ถูกต้อง');
  }
  if (!sa.client_email || !sa.private_key) throw new HttpError(500, 'GOOGLE_SA_JSON ไม่มี client_email หรือ private_key');
  const pem = sa.private_key
    .replace(/\\n/g, '\n')
    .replace(/-----BEGIN PRIVATE KEY-----|-----END PRIVATE KEY-----|\s+/g, '');
  const der = Uint8Array.from(atob(pem), (c) => c.charCodeAt(0));
  const key = crypto.subtle.importKey('pkcs8', der, { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' }, false, ['sign']);
  saCache = { raw: env.GOOGLE_SA_JSON, sa, key };
  tokenCache = null;
  return saCache;
}

async function accessToken(env: Env): Promise<string> {
  const now = Math.floor(Date.now() / 1000);
  if (tokenCache && tokenCache.exp - 120 > now) return tokenCache.token;
  const { sa, key } = serviceAccount(env);
  const header = b64url(JSON.stringify({ alg: 'RS256', typ: 'JWT' }));
  const claims = b64url(
    JSON.stringify({
      iss: sa.client_email,
      scope: 'https://www.googleapis.com/auth/spreadsheets',
      aud: 'https://oauth2.googleapis.com/token',
      iat: now,
      exp: now + 3600,
    }),
  );
  const unsigned = `${header}.${claims}`;
  const sig = await crypto.subtle.sign('RSASSA-PKCS1-v1_5', await key, utf8(unsigned));
  const res = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer',
      assertion: `${unsigned}.${b64url(sig)}`,
    }),
  });
  if (!res.ok) throw new HttpError(500, `Google auth error ${res.status}`, await res.text());
  const j = (await res.json()) as { access_token: string; expires_in: number };
  tokenCache = { token: j.access_token, exp: now + j.expires_in };
  return j.access_token;
}

// ---------- Sheets REST client ----------

export class SheetsError extends Error {
  constructor(
    public status: number,
    public body: string,
  ) {
    super(`Sheets API ${status}: ${body.slice(0, 300)}`);
  }
  get isMissingRange(): boolean {
    return this.status === 400 && /Unable to parse range/i.test(this.body);
  }
  get isAlreadyExists(): boolean {
    return this.status === 400 && /already exists/i.test(this.body);
  }
}

export const quoteRange = (sheet: string, a1: string) => `'${sheet.replace(/'/g, "''")}'!${a1}`;

export class Sheets {
  private base: string;

  constructor(private env: Env) {
    this.base = `https://sheets.googleapis.com/v4/spreadsheets/${encodeURIComponent(env.SPREADSHEET_ID)}`;
  }

  private async req<T>(path: string, init: RequestInit = {}): Promise<T> {
    const token = await accessToken(this.env);
    const res = await fetch(this.base + path, {
      ...init,
      headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
    });
    const text = await res.text();
    if (!res.ok) {
      if (res.status === 403 || res.status === 404) {
        throw new HttpError(
          500,
          'เข้าถึง Google Sheet ไม่ได้ — ตรวจสอบ SPREADSHEET_ID และแชร์ชีตให้ service account เป็น Editor',
          text.slice(0, 300),
        );
      }
      throw new SheetsError(res.status, text);
    }
    return (text ? JSON.parse(text) : {}) as T;
  }

  /** Read several ranges in one call. Dates/times come back as serial numbers. */
  async batchGet(ranges: string[]): Promise<unknown[][][]> {
    if (!ranges.length) return [];
    const p = new URLSearchParams();
    for (const r of ranges) p.append('ranges', r);
    p.set('valueRenderOption', 'UNFORMATTED_VALUE');
    p.set('dateTimeRenderOption', 'SERIAL_NUMBER');
    p.set('majorDimension', 'ROWS');
    const j = await this.req<{ valueRanges?: { values?: unknown[][] }[] }>(`/values:batchGet?${p}`);
    return ranges.map((_, i) => j.valueRanges?.[i]?.values ?? []);
  }

  async append(sheet: string, rows: unknown[][]): Promise<void> {
    if (!rows.length) return;
    const range = encodeURIComponent(quoteRange(sheet, 'A1'));
    await this.req(`/values/${range}:append?valueInputOption=RAW&insertDataOption=INSERT_ROWS`, {
      method: 'POST',
      body: JSON.stringify({ values: rows }),
    });
  }

  async update(data: { range: string; values: unknown[][] }[]): Promise<void> {
    if (!data.length) return;
    await this.req('/values:batchUpdate', {
      method: 'POST',
      body: JSON.stringify({ valueInputOption: 'RAW', data }),
    });
  }

  async clear(ranges: string[]): Promise<void> {
    if (!ranges.length) return;
    await this.req('/values:batchClear', { method: 'POST', body: JSON.stringify({ ranges }) });
  }

  async titles(): Promise<Set<string>> {
    const j = await this.req<{ sheets?: { properties: { title: string } }[] }>('?fields=sheets.properties.title');
    return new Set((j.sheets ?? []).map((s) => s.properties.title));
  }

  async addSheet(title: string): Promise<void> {
    await this.req(':batchUpdate', {
      method: 'POST',
      body: JSON.stringify({
        requests: [{ addSheet: { properties: { title, gridProperties: { frozenRowCount: 1 } } } }],
      }),
    });
  }
}
