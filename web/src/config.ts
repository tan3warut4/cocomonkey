export const LIFF_ID = import.meta.env.VITE_LIFF_ID ?? '';

export const API_URL =
  (import.meta.env.VITE_API_URL ?? '').replace(/\/$/, '') || (import.meta.env.DEV ? 'http://localhost:8787' : '');

/** Local dev without a LIFF app: logs in as "dev:<id>" (Worker needs DEV_AUTH=true). */
export const DEV_MODE = import.meta.env.DEV && !LIFF_ID;

export const CONFIG_ERROR = !API_URL
  ? 'ยังไม่ได้ตั้งค่า VITE_API_URL'
  : !LIFF_ID && !import.meta.env.DEV
    ? 'ยังไม่ได้ตั้งค่า VITE_LIFF_ID'
    : '';
