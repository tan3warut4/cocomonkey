// Types shared by the Worker API and the web app (type-only imports).

export type Role = 'owner' | 'staff';
export type StaffStatus = 'pending' | 'active' | 'inactive';
export type PunchType = 'IN' | 'OUT';

export interface Store {
  id: string;
  name: string;
  lat: number;
  lng: number;
  radiusM: number;
  active: boolean;
}

export interface Staff {
  id: string;
  lineUserId: string;
  lineName: string;
  name: string;
  nickname: string;
  phone: string;
  role: Role;
  storeId: string; // home store
  status: StaffStatus;
  createdAt: string;
}

/** Shift template, e.g. "เช้า 08:30–17:30" for a store. */
export interface ShiftType {
  id: string;
  storeId: string;
  name: string;
  start: string; // HH:mm
  end: string; // HH:mm (may be <= start for overnight)
  breakMin: number;
  active: boolean;
}

/** One scheduled shift for one staff member on one date. */
export interface Shift {
  id: string;
  date: string; // YYYY-MM-DD (Bangkok)
  staffId: string;
  storeId: string;
  shiftTypeId: string;
  start: string; // HH:mm
  end: string; // HH:mm
  breakMin: number;
  note: string;
}

export interface Punch {
  id: string;
  ms: number; // epoch ms
  ts: string; // ISO with +07:00
  date: string; // YYYY-MM-DD (Bangkok)
  time: string; // HH:mm:ss (Bangkok)
  staffId: string;
  storeId: string;
  type: PunchType;
  lat: number;
  lng: number;
  accuracyM: number;
  distanceM: number;
}

export interface Settings {
  lateGraceMin: number; // late only if later than start + grace
  otMinMin: number; // minimum minutes after shift end to count OT
  otRoundMin: number; // OT rounded down to this block
  maxAccuracyM: number; // reject punches with worse GPS accuracy
}

export type DayFlag =
  | 'late'
  | 'early_leave'
  | 'absent'
  | 'missing_out'
  | 'missing_in'
  | 'unscheduled'
  | 'upcoming'
  | 'not_in_yet'
  | 'in_progress'
  | 'ot';

export interface DayRecord {
  date: string;
  staffId: string;
  storeId: string;
  shiftId?: string;
  shiftName?: string;
  schedStart?: string;
  schedEnd?: string;
  breakMin?: number;
  inTs?: string;
  outTs?: string;
  inStoreId?: string;
  lateMin: number;
  earlyLeaveMin: number;
  regularMin: number;
  otMin: number;
  unscheduledMin: number;
  flags: DayFlag[];
}

export interface StaffSummary {
  staffId: string;
  name: string;
  scheduled: number;
  attended: number;
  absent: number;
  lateCount: number;
  lateMin: number;
  earlyLeaveMin: number;
  regularMin: number;
  otMin: number;
  unscheduledMin: number;
  missingPunch: number;
}

// ---------- API payloads ----------

export interface MeResponse {
  me: Staff | null;
  lineName: string;
  stores: Store[];
  shiftTypes: ShiftType[];
  settings: Settings;
  openPunch: Punch | null;
  todayPunches: Punch[];
  todayShifts: Shift[];
  upcomingShifts: Shift[]; // today + 13 days
  serverTime: string;
}

export interface LoginResponse extends MeResponse {
  token: string;
}

export interface RegisterRequest {
  name: string;
  nickname: string;
  phone: string;
  storeId: string;
  ownerCode?: string;
}

export interface PunchRequest {
  type: PunchType;
  lat: number;
  lng: number;
  accuracy: number;
}

export interface PunchResponse {
  punch: Punch;
  storeName: string;
  distanceM: number;
  lateMin: number;
  otMin: number;
  shift: Shift | null;
  message: string;
}

export interface RosterResponse {
  from: string;
  to: string;
  staff: Staff[];
  stores: Store[];
  shiftTypes: ShiftType[];
  shifts: Shift[];
}

export interface RosterSaveRequest {
  from: string;
  to: string;
  cells: { date: string; staffId: string; shiftTypeId: string | null }[];
}

export interface ReportResponse {
  month: string;
  from: string;
  to: string;
  staff: Staff[];
  stores: Store[];
  settings: Settings;
  summaries: StaffSummary[];
  days: DayRecord[];
}

export interface TodayResponse {
  date: string;
  stores: Store[];
  staff: Staff[];
  days: DayRecord[];
}

export interface MyAttendanceResponse {
  month: string;
  summary: StaffSummary;
  days: DayRecord[];
}

export interface StaffUpdateRequest {
  status?: StaffStatus;
  role?: Role;
  storeId?: string;
  name?: string;
  nickname?: string;
  phone?: string;
}

export interface StoreUpdateRequest {
  lat?: number;
  lng?: number;
  radiusM?: number;
  name?: string;
}

export interface ApiErrorBody {
  error: string;
  detail?: unknown;
}
