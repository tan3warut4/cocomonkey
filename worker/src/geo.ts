import type { Store } from '../../shared/types';

/** Great-circle distance in metres. */
export function haversineM(lat1: number, lng1: number, lat2: number, lng2: number): number {
  const R = 6_371_000;
  const toRad = (d: number) => (d * Math.PI) / 180;
  const dLat = toRad(lat2 - lat1);
  const dLng = toRad(lng2 - lng1);
  const a = Math.sin(dLat / 2) ** 2 + Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(a));
}

export function nearestStore(stores: Store[], lat: number, lng: number): { store: Store; distanceM: number } | null {
  let best: { store: Store; distanceM: number } | null = null;
  for (const s of stores) {
    if (!s.active) continue;
    const d = haversineM(lat, lng, s.lat, s.lng);
    if (!best || d < best.distanceM) best = { store: s, distanceM: d };
  }
  return best;
}

export function fmtDistance(m: number): string {
  return m >= 1000 ? `${(m / 1000).toFixed(1)} กม.` : `${Math.round(m)} ม.`;
}
