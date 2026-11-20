import type { Staff } from '../../shared/types';
import type { SessionUser } from './auth';
import type { Loaded } from './data';
import type { Env } from './env';
import type { Sheets } from './sheets';
import { HttpError } from './util';

export interface Ctx {
  req: Request;
  env: Env;
  url: URL;
  params: Record<string, string>;
  sheets: Sheets;
  user: SessionUser | null;
}

export type Handler = (c: Ctx) => Promise<unknown>;

export function requireUser(c: Ctx): SessionUser {
  if (!c.user) throw new HttpError(401, 'กรุณาเข้าสู่ระบบใหม่');
  return c.user;
}

export async function readJson<T>(req: Request): Promise<T> {
  try {
    return (await req.json()) as T;
  } catch {
    throw new HttpError(400, 'ข้อมูลที่ส่งมาไม่ถูกต้อง (JSON)');
  }
}

export function findMe(d: Loaded, user: SessionUser): Staff | null {
  return d.staff.find((s) => s.lineUserId === user.uid) ?? null;
}

export function requireActive(d: Loaded, user: SessionUser): Staff {
  const me = findMe(d, user);
  if (!me) throw new HttpError(403, 'ยังไม่ได้ลงทะเบียนพนักงาน');
  if (me.status === 'pending') throw new HttpError(403, 'บัญชีของคุณรอเจ้าของร้านอนุมัติ');
  if (me.status !== 'active') throw new HttpError(403, 'บัญชีของคุณถูกปิดการใช้งาน');
  return me;
}

export function requireOwner(d: Loaded, user: SessionUser): Staff {
  const me = requireActive(d, user);
  if (me.role !== 'owner') throw new HttpError(403, 'เฉพาะเจ้าของร้านเท่านั้น');
  return me;
}

export const displayName = (s: Pick<Staff, 'name' | 'nickname'>) => (s.nickname ? `${s.name} (${s.nickname})` : s.name);
