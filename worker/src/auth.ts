import type { Env } from './env';
import { HttpError, b64url, b64urlToBytes, b64urlToString, utf8 } from './util';

export interface SessionUser {
  uid: string; // LINE user id
  name: string; // LINE display name
}

/** Verify a LIFF ID token with LINE and return the LINE user. */
export async function verifyLineIdToken(env: Env, idToken: string): Promise<SessionUser> {
  if (env.DEV_AUTH === 'true' && idToken.startsWith('dev:')) {
    const uid = idToken.slice(4) || 'dev-user';
    return { uid, name: `Dev ${uid}` };
  }
  const res = await fetch('https://api.line.me/oauth2/v2.1/verify', {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ id_token: idToken, client_id: env.LINE_CHANNEL_ID }),
  });
  if (!res.ok) {
    throw new HttpError(401, 'ยืนยันตัวตนกับ LINE ไม่สำเร็จ กรุณาเปิดแอปใหม่', await res.text());
  }
  const j = (await res.json()) as { sub?: string; name?: string };
  if (!j.sub) throw new HttpError(401, 'LINE token ไม่มีข้อมูลผู้ใช้');
  return { uid: j.sub, name: j.name ?? '' };
}

// ---- Session token: base64url(payload).base64url(HMAC-SHA256) ----

let hmac: { secret: string; key: Promise<CryptoKey> } | null = null;

function hmacKey(env: Env): Promise<CryptoKey> {
  if (!hmac || hmac.secret !== env.SESSION_SECRET) {
    hmac = {
      secret: env.SESSION_SECRET,
      key: crypto.subtle.importKey('raw', utf8(env.SESSION_SECRET), { name: 'HMAC', hash: 'SHA-256' }, false, [
        'sign',
        'verify',
      ]),
    };
  }
  return hmac.key;
}

const SESSION_TTL_SEC = 12 * 3600;

export async function signSession(env: Env, user: SessionUser): Promise<string> {
  const payload = b64url(JSON.stringify({ ...user, exp: Math.floor(Date.now() / 1000) + SESSION_TTL_SEC }));
  const sig = await crypto.subtle.sign('HMAC', await hmacKey(env), utf8(payload));
  return `${payload}.${b64url(sig)}`;
}

export async function verifySession(env: Env, token: string): Promise<SessionUser | null> {
  const [payload, sig] = token.split('.');
  if (!payload || !sig) return null;
  try {
    const ok = await crypto.subtle.verify('HMAC', await hmacKey(env), b64urlToBytes(sig), utf8(payload));
    if (!ok) return null;
    const data = JSON.parse(b64urlToString(payload)) as SessionUser & { exp: number };
    if (!data.uid || data.exp * 1000 < Date.now()) return null;
    return { uid: data.uid, name: data.name };
  } catch {
    return null;
  }
}
