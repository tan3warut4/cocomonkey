import type { Store } from '@shared/types';

export interface Position {
  lat: number;
  lng: number;
  accuracy: number;
}

export function getPosition(timeoutMs = 15_000): Promise<Position> {
  return new Promise((resolve, reject) => {
    if (!('geolocation' in navigator)) {
      reject(new Error('อุปกรณ์นี้ไม่รองรับการระบุตำแหน่ง'));
      return;
    }
    navigator.geolocation.getCurrentPosition(
      (p) => resolve({ lat: p.coords.latitude, lng: p.coords.longitude, accuracy: p.coords.accuracy }),
      (err) => {
        const msg =
          err.code === err.PERMISSION_DENIED
            ? 'ไม่ได้รับอนุญาตให้ใช้ตำแหน่ง — เปิด Location ให้แอป LINE ในการตั้งค่าโทรศัพท์ แล้วลองใหม่'
            : err.code === err.TIMEOUT
              ? 'หาตำแหน่งไม่ทัน กรุณาลองใหม่'
              : 'หาตำแหน่งไม่ได้ ตรวจสอบว่าเปิด GPS แล้ว';
        reject(new Error(msg));
      },
      { enableHighAccuracy: true, timeout: timeoutMs, maximumAge: 0 },
    );
  });
}

export function haversineM(lat1: number, lng1: number, lat2: number, lng2: number): number {
  const R = 6_371_000;
  const rad = (d: number) => (d * Math.PI) / 180;
  const a =
    Math.sin(rad(lat2 - lat1) / 2) ** 2 +
    Math.cos(rad(lat1)) * Math.cos(rad(lat2)) * Math.sin(rad(lng2 - lng1) / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(a));
}

export function nearestStore(stores: Store[], pos: Position): { store: Store; distanceM: number } | null {
  let best: { store: Store; distanceM: number } | null = null;
  for (const s of stores) {
    if (!s.active) continue;
    const d = haversineM(pos.lat, pos.lng, s.lat, s.lng);
    if (!best || d < best.distanceM) best = { store: s, distanceM: d };
  }
  return best;
}

export function fmtDistance(m: number): string {
  return m >= 1000 ? `${(m / 1000).toFixed(1)} กม.` : `${Math.round(m)} ม.`;
}
