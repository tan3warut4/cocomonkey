export interface Env {
  /** Google Sheet ID (from the sheet URL). */
  SPREADSHEET_ID: string;
  /** LINE Login channel ID (the channel that owns the LIFF app). */
  LINE_CHANNEL_ID: string;
  /** Comma-separated list of allowed web origins, e.g. "https://you.github.io,http://localhost:5173". */
  ALLOWED_ORIGINS: string;

  // ---- secrets (wrangler secret put ...) ----
  /** Full JSON key file of the Google service account. */
  GOOGLE_SA_JSON: string;
  /** Random string used to sign session tokens. */
  SESSION_SECRET: string;
  /** Random string used for /api/setup and for registering the first owner. */
  SETUP_KEY: string;

  /** "true" only in local dev (.dev.vars): accepts "dev:<id>" instead of a LINE ID token. */
  DEV_AUTH?: string;
}

export function checkEnv(env: Env): string[] {
  const missing: string[] = [];
  for (const k of ['SPREADSHEET_ID', 'LINE_CHANNEL_ID', 'GOOGLE_SA_JSON', 'SESSION_SECRET'] as const) {
    if (!env[k]) missing.push(k);
  }
  return missing;
}
