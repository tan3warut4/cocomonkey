import type {
  LoginResponse,
  MeResponse,
  MyAttendanceResponse,
  PunchRequest,
  PunchResponse,
  RegisterRequest,
  ReportResponse,
  RosterResponse,
  RosterSaveRequest,
  Staff,
  StaffUpdateRequest,
  Store,
  StoreUpdateRequest,
  TodayResponse,
} from '@shared/types';
import { API_URL } from '../config';
import { getIdToken } from './liff';

export class ApiError extends Error {
  constructor(
    public status: number,
    message: string,
    public detail?: unknown,
  ) {
    super(message);
  }
}

let token: string | null = null;

async function request<T>(method: string, path: string, body?: unknown, retry = true): Promise<T> {
  const headers: Record<string, string> = {};
  if (body !== undefined) headers['content-type'] = 'application/json';
  if (token) headers.authorization = `Bearer ${token}`;

  let res: Response;
  try {
    res = await fetch(API_URL + path, {
      method,
      headers,
      body: body !== undefined ? JSON.stringify(body) : undefined,
    });
  } catch {
    throw new ApiError(0, 'เชื่อมต่อเซิร์ฟเวอร์ไม่ได้ ตรวจสอบอินเทอร์เน็ตแล้วลองใหม่');
  }
  const data = (await res.json().catch(() => ({}))) as { error?: string; detail?: unknown };

  if (res.status === 401 && retry && path !== '/api/auth/login') {
    await login();
    return request<T>(method, path, body, false);
  }
  if (!res.ok) throw new ApiError(res.status, data.error ?? `HTTP ${res.status}`, data.detail);
  return data as T;
}

/** LINE ID token -> session token + current user state. */
export async function login(force = false): Promise<LoginResponse> {
  const idToken = await getIdToken(force);
  token = null;
  const r = await request<LoginResponse>('POST', '/api/auth/login', { idToken }, false);
  token = r.token;
  return r;
}

export const api = {
  me: () => request<MeResponse>('GET', '/api/me'),
  register: (b: RegisterRequest) => request<MeResponse>('POST', '/api/register', b),
  punch: (b: PunchRequest) => request<PunchResponse>('POST', '/api/punch', b),
  myAttendance: (month: string) => request<MyAttendanceResponse>('GET', `/api/my/attendance?month=${month}`),

  staff: () => request<{ staff: Staff[]; stores: Store[] }>('GET', '/api/admin/staff'),
  updateStaff: (id: string, b: StaffUpdateRequest) =>
    request<{ staff: Staff }>('POST', `/api/admin/staff/${encodeURIComponent(id)}`, b),
  updateStore: (id: string, b: StoreUpdateRequest) =>
    request<{ store: Store }>('POST', `/api/admin/stores/${encodeURIComponent(id)}`, b),
  roster: (from: string, days = 7) => request<RosterResponse>('GET', `/api/admin/roster?from=${from}&days=${days}`),
  saveRoster: (b: RosterSaveRequest) => request<RosterResponse>('PUT', '/api/admin/roster', b),
  today: () => request<TodayResponse>('GET', '/api/admin/today'),
  report: (month: string) => request<ReportResponse>('GET', `/api/admin/report?month=${month}`),
};

export const errMsg = (e: unknown) => (e instanceof Error ? e.message : String(e));
