import { verifySession } from './auth';
import type { Ctx, Handler } from './ctx';
import { type Env, checkEnv } from './env';
import * as admin from './handlers/admin';
import { setup } from './handlers/setup';
import * as staff from './handlers/staff';
import { Sheets, SheetsError } from './sheets';
import { HttpError } from './util';

interface Route {
  method: string;
  pattern: RegExp;
  keys: string[];
  handler: Handler;
}

const routes: Route[] = [];
function on(method: string, path: string, handler: Handler) {
  const keys: string[] = [];
  const pattern = new RegExp(
    '^' +
      path.replace(/:(\w+)/g, (_, k: string) => {
        keys.push(k);
        return '([^/]+)';
      }) +
      '/?$',
  );
  routes.push({ method, pattern, keys, handler });
}

on('GET', '/api/health', async () => ({ ok: true }));
on('POST', '/api/setup', setup);

on('POST', '/api/auth/login', staff.login);
on('GET', '/api/me', staff.getMe);
on('POST', '/api/register', staff.register);
on('POST', '/api/punch', staff.punch);
on('GET', '/api/my/attendance', staff.myAttendance);

on('GET', '/api/admin/staff', admin.listStaff);
on('POST', '/api/admin/staff/:id', admin.updateStaff);
on('POST', '/api/admin/stores/:id', admin.updateStore);
on('GET', '/api/admin/roster', admin.getRoster);
on('PUT', '/api/admin/roster', admin.saveRoster);
on('GET', '/api/admin/today', admin.today);
on('GET', '/api/admin/report', admin.report);

function corsHeaders(req: Request, env: Env): Record<string, string> {
  const origin = req.headers.get('origin') ?? '';
  const allowed = (env.ALLOWED_ORIGINS ?? '')
    .split(',')
    .map((s) => s.trim().replace(/\/$/, ''))
    .filter(Boolean);
  const h: Record<string, string> = {
    'access-control-allow-methods': 'GET,POST,PUT,OPTIONS',
    'access-control-allow-headers': 'authorization,content-type,x-setup-key',
    'access-control-max-age': '86400',
    vary: 'Origin',
  };
  if (origin && allowed.includes(origin)) h['access-control-allow-origin'] = origin;
  return h;
}

function json(body: unknown, status: number, extra: Record<string, string>): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store', ...extra },
  });
}

export default {
  async fetch(req: Request, env: Env): Promise<Response> {
    const cors = corsHeaders(req, env);
    if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: cors });

    const url = new URL(req.url);
    try {
      const missing = checkEnv(env);
      if (missing.length) throw new HttpError(500, `Worker ยังตั้งค่าไม่ครบ: ${missing.join(', ')}`);

      const route = routes.find((r) => r.method === req.method && r.pattern.test(url.pathname));
      if (!route) throw new HttpError(404, 'Not found');
      const m = url.pathname.match(route.pattern)!;
      const params: Record<string, string> = {};
      route.keys.forEach((k, i) => (params[k] = decodeURIComponent(m[i + 1])));

      const auth = req.headers.get('authorization') ?? '';
      const token = auth.startsWith('Bearer ') ? auth.slice(7) : '';
      const ctx: Ctx = {
        req,
        env,
        url,
        params,
        sheets: new Sheets(env),
        user: token ? await verifySession(env, token) : null,
      };
      return json(await route.handler(ctx), 200, cors);
    } catch (e) {
      if (e instanceof HttpError) {
        if (e.status >= 500) console.error(e.message, e.detail);
        return json({ error: e.message, detail: e.status < 500 ? e.detail : undefined }, e.status, cors);
      }
      console.error(e instanceof SheetsError ? e.message : e);
      return json({ error: 'เกิดข้อผิดพลาดในระบบ กรุณาลองใหม่' }, 500, cors);
    }
  },
};
