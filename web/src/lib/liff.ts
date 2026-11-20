import liff from '@line/liff';
import { DEV_MODE, LIFF_ID } from '../config';

let initPromise: Promise<void> | null = null;
const never = () => new Promise<never>(() => {});

function init(): Promise<void> {
  return (initPromise ??= liff.init({ liffId: LIFF_ID }));
}

/**
 * Returns a LINE ID token for the Worker to verify.
 * Redirects to LINE Login when needed (the returned promise then never resolves).
 */
export async function getIdToken(force = false): Promise<string> {
  if (DEV_MODE) {
    const as = new URLSearchParams(location.search).get('as');
    if (as) localStorage.setItem('dev_uid', as);
    return `dev:${localStorage.getItem('dev_uid') || 'owner'}`;
  }

  await init();

  if (liff.isInClient()) {
    // Inside LINE the user is always logged in; an expired token is fixed by reopening.
    const decoded = liff.getDecodedIDToken();
    const expired = !decoded || (decoded.exp ?? 0) * 1000 < Date.now() + 60_000;
    if (expired || force) {
      if (!sessionStorage.getItem('liff_reloaded')) {
        sessionStorage.setItem('liff_reloaded', '1');
        location.reload();
        return never();
      }
      throw new Error('การเข้าสู่ระบบหมดอายุ กรุณาปิดแล้วเปิดแอปใหม่');
    }
    sessionStorage.removeItem('liff_reloaded');
  } else {
    // External browser (e.g. owner on a computer)
    if (force && liff.isLoggedIn()) liff.logout();
    const decoded = liff.isLoggedIn() ? liff.getDecodedIDToken() : null;
    if (!decoded || (decoded.exp ?? 0) * 1000 < Date.now() + 60_000) {
      if (liff.isLoggedIn()) liff.logout();
      liff.login({ redirectUri: location.href });
      return never();
    }
  }

  const token = liff.getIDToken();
  if (!token) throw new Error('ไม่พบ ID token — เปิด scope "openid" ในการตั้งค่า LIFF');
  return token;
}

export function isInLine(): boolean {
  return !DEV_MODE && liff.isInClient();
}

/** Open the app in the phone's normal browser (for CSV downloads). */
export function openInBrowser(): void {
  liff.openWindow({ url: location.origin + location.pathname, external: true });
}

export function closeApp(): void {
  if (isInLine()) liff.closeWindow();
}
