# Jingjo Coconut · Staff clock-in & shifts (LINE LIFF)

A LINE LIFF web app for a small shop (2 stores, ~10 staff):

- **Clock in / out by location.** The phone's GPS must be within the store radius (default 150 m). The server records the time, not the phone.
- **Shift roster.** The owner assigns shift templates per day in a weekly grid, with "copy last week".
- **Late, early-leave and overtime calculation,** plus a monthly report and CSV export for payroll.
- **Google Sheets is the database,** so the owner can read or fix any data directly in the sheet.

Running cost: **0 THB/month** on free tiers (Cloudflare Workers, GitHub Pages, Google Sheets API, LINE Login).

```
LINE app ──> LIFF web app (GitHub Pages, React + TS + Vite)
                 │  LIFF ID token
                 ▼
         Cloudflare Worker API (TypeScript, no runtime deps)
                 │  verifies token with LINE, checks geofence, calculates late/OT
                 ▼
         Google Sheet (service account)
```

## Repo layout

| Path | What |
|---|---|
| `web/` | LIFF front end (Thai UI). Staff: ลงเวลา, กะของฉัน, ประวัติ. Owner: จัดการร้าน (วันนี้, ตารางกะ, รายงาน, พนักงาน, สาขา) |
| `worker/` | Cloudflare Worker API |
| `worker/src/attendance.ts` | Late / OT rules (unit-tested in `attendance.test.ts`) |
| `shared/types.ts` | Types shared by both |
| `.github/workflows/deploy-web.yml` | Builds `web/` and publishes to GitHub Pages |
| `docs/SETUP.md` | **Step-by-step setup: Google, LINE, Cloudflare, GitHub** |

## Quick start (local, no LINE needed)

```bash
# 1) API — needs a Google Sheet + service account (docs/SETUP.md steps 1–2)
cd worker && npm install
cp .dev.vars.example .dev.vars        # fill in GOOGLE_SA_JSON etc. (DEV_AUTH=true)
# put your SPREADSHEET_ID in wrangler.toml (or override it in .dev.vars)
npm run dev                            # http://localhost:8787
curl -X POST http://localhost:8787/api/setup -H "X-Setup-Key: <SETUP_KEY>"

# 2) Web
cd ../web && npm install
cp .env.example .env.local             # leave VITE_LIFF_ID empty = DEV mode
npm run dev                            # open http://localhost:5173/?as=owner
```

In DEV mode, `?as=<anything>` logs you in as a fake LINE user. Register the first one with the owner code (= `SETUP_KEY`). To fake GPS, use Chrome DevTools → More tools → Sensors → Location.

```bash
cd worker && npm test                  # late/OT + date parsing tests
```

## Calculation rules (editable in the `Settings` tab)

| Setting | Default | Meaning |
|---|---|---|
| `late_grace_min` | 5 | Late only if clock-in is more than 5 min after shift start. If late, minutes count from shift start. |
| `ot_min_minutes` | 30 | Minutes after shift end must reach 30 to count as OT. |
| `ot_round_minutes` | 15 | OT is rounded down to 15-minute blocks (50 min → 45). |
| `max_gps_accuracy_m` | 100 | Reject a punch when GPS accuracy is worse than ±100 m. |

- **Regular minutes** = time worked inside the shift minus the break. Arriving early is not paid.
- **Overnight shifts** (end time earlier than start) end the next day.
- **Punches with no shift** are reported as "นอกตาราง" (unscheduled) for the owner to decide. They are not added to regular hours or OT.
- **Forgotten clock-outs** show as "ลืมลงเวลาออก". To fix one, add a row in that month's `Attendance_YYYY-MM` tab: `type = OUT`, `staff_id`, and `timestamp` like `2026-11-19 17:30`.

See `docs/SETUP.md` for deployment and day-to-day operation.
