# Setup guide

Do these in order. Keep a note of the values in **bold**, because later steps need them.

| Value | Where it comes from | Where it goes |
|---|---|---|
| **SPREADSHEET_ID** | Google Sheet URL | `worker/wrangler.toml` |
| **Service account JSON key** | Google Cloud | Worker secret `GOOGLE_SA_JSON` |
| **LINE_CHANNEL_ID** | LINE Login channel → Basic settings | `worker/wrangler.toml` |
| **LIFF ID** | LINE Login channel → LIFF | GitHub variable `VITE_LIFF_ID` |
| **Worker URL** | `wrangler deploy` output | GitHub variable `VITE_API_URL` |
| **GitHub Pages URL** | `https://tan3warut4.github.io/cocomonkey/` | LIFF endpoint URL (`ALLOWED_ORIGINS` is already set) |

You need Node.js 22+ and Git.

---

## 1. Google Sheet

1. Sign in with the **shop's** Google account, so the data belongs to the business rather than one person.
2. Create a blank Google Sheet, e.g. "Cocomonkey Staff DB".
   Share it as **Editor** with the owner's personal Google account (and yours, while you maintain the app) so they can open it from their own login.
3. Copy the ID from the URL: `https://docs.google.com/spreadsheets/d/`**`THIS_PART`**`/edit` → **SPREADSHEET_ID**.

The tabs are created later by `/api/setup`. Leave the sheet empty.

## 2. Google service account (lets the Worker edit the sheet)

1. Open https://console.cloud.google.com → create a project, e.g. `cocomonkey-staff`.
2. **APIs & Services → Library** → search **Google Sheets API** → **Enable**.
3. **IAM & Admin → Service Accounts → Create service account**, e.g. `cocomonkey-sheets`. No roles are needed. Click Done.
4. Open the service account → **Keys → Add key → Create new key → JSON**. A `.json` file downloads. This is the **Service account JSON key**. Keep it private and never commit it.
5. Copy the service account email (`cocomonkey-sheets@<project>.iam.gserviceaccount.com`).
6. In the Google Sheet, click **Share**, paste that email, give it **Editor**, untick "Notify", and share.

> If step 4 says key creation is disabled, the account is under a Google Workspace/Cloud organization that blocks keys. Use a regular Google account, or ask the org admin to allow keys for this project.

## 3. LINE Login channel + LIFF app

1. Open https://developers.line.biz/console → create a **Provider** (e.g. "Cocomonkey").
   If the shop already has a LINE Official Account, use the same provider it's under.
2. **Create a new channel → LINE Login**:
   - Region: Thailand. App type: **Web app**. Fill in the name, description and email.
3. **Basic settings** → copy **Channel ID** → **LINE_CHANNEL_ID**.
4. **LIFF** tab → **Add**:
   - Size: **Full**
   - Endpoint URL: `https://tan3warut4.github.io/cocomonkey/`
   - Scopes: tick **openid** and **profile**
   - Add friend option: "On (normal)" if you linked the Official Account, otherwise Off
   - Save → copy the **LIFF ID** (looks like `1234567890-AbCdEfGh`).
5. At the top of the channel page, switch the status from **Developing** to **Published**.
   While "Developing", only channel admins/testers can log in, so staff would get an error.

The link staff will open is `https://liff.line.me/<LIFF ID>`.

## 4. Cloudflare Worker (API)

```bash
cd worker
npm install
npx wrangler login          # opens the browser, sign in to Cloudflare
```

Edit `worker/wrangler.toml` and fill in the two IDs. `ALLOWED_ORIGINS` is already set to your GitHub Pages origin.

```toml
[vars]
SPREADSHEET_ID = "<SPREADSHEET_ID>"
LINE_CHANNEL_ID = "<LINE_CHANNEL_ID>"
ALLOWED_ORIGINS = "https://tan3warut4.github.io,http://localhost:5173"
```

`ALLOWED_ORIGINS` is the origin only: no `/cocomonkey` path, no trailing slash.

Set the secrets. Each command prompts for the value, except the first one, which reads the file:

```bash
npx wrangler secret put GOOGLE_SA_JSON < ~/Downloads/<your-key>.json
npx wrangler secret put SESSION_SECRET     # paste output of: openssl rand -hex 32
npx wrangler secret put SETUP_KEY          # any long random text; also the "owner code"
npx wrangler deploy
```

The deploy prints the **Worker URL**, e.g. `https://cocomonkey-staff-api.<you>.workers.dev`.
The first time, Cloudflare may ask you to choose a `workers.dev` subdomain.

Create the sheet tabs and starting data: both stores (pinned from Google Maps), 5 shift templates, the 5 staff nicknames and default settings:

```bash
curl -X POST https://cocomonkey-staff-api.<you>.workers.dev/api/setup -H "X-Setup-Key: <SETUP_KEY>"
```

The Google Sheet should now have the tabs `Stores`, `Staff`, `ShiftTypes`, `Shifts`, `Settings` and `Attendance_YYYY-MM`. You can delete the default `Sheet1`.

Never set `DEV_AUTH` on the deployed Worker. It is for local development only.

## 5. GitHub repo + Pages (front end)

GitHub Pages is free for **public** repos, so the code is public. That's fine, because every secret lives in Cloudflare, not in the repo.

The repo `tan3warut4/cocomonkey` already exists. Make sure it is **public**, then push:

```bash
cd ~/Desktop/cocomonkey
git add . && git commit -m "Cocomonkey staff app"
git push -u origin main
```

On GitHub:

1. **Settings → Pages → Build and deployment → Source: GitHub Actions**.
2. **Settings → Secrets and variables → Actions → Variables tab → New repository variable**:
   - `VITE_LIFF_ID` = **LIFF ID**
   - `VITE_API_URL` = **Worker URL** (no trailing slash)
3. **Actions** tab → "Deploy web app to GitHub Pages" → **Run workflow**. Later pushes to `main` deploy automatically.

The site goes live at `https://tan3warut4.github.io/cocomonkey/`. Make sure this exact URL is the LIFF **Endpoint URL** (step 3.4).

## 6. First run

1. On your phone, open `https://liff.line.me/<LIFF ID>` in LINE (send it to yourself in a chat and tap it).
2. Allow location when asked. On iOS, check **Settings → LINE → Location → While Using the App**.
3. Register: tap **ไม่มีชื่อในรายการ**, fill in the form, open **สำหรับเจ้าของร้าน**, and enter the **owner code** (= `SETUP_KEY`). You are now the owner.
4. Store pins are already set from Google Maps. Clock in once at each store to test. If it says **นอกพื้นที่** while you're inside, go to **จัดการร้าน → สาขา** and tap **ใช้ตำแหน่งปัจจุบันเป็นที่ตั้งร้าน** while standing in the store.
5. Check the shift templates in the `ShiftTypes` tab against the real rota (name, start, end, break). The defaults are guesses from the opening hours.
6. Send the LIFF link to staff, or add it to the Official Account's rich menu (LINE Official Account Manager → Rich menus → action = Link → `https://liff.line.me/<LIFF ID>`).
7. Staff open the link, tap their own nickname (แก้ว, มวย, แอมมี่, นุ่น, มิ๊ก), fill in their full name, phone and home store → **จัดการร้าน → พนักงาน → อนุมัติ**. Check the LINE name shown before approving, so nobody claims someone else's name.
   You can schedule them in the roster before they link LINE.
8. **จัดการร้าน → ตารางกะ**: assign shifts for the week → **บันทึก**. Next week, use **คัดลอกสัปดาห์ก่อน**.

---

## Editing the Google Sheet by hand

The sheet is the database, and hand edits are fine with a few rules:

- Don't rename tabs or header cells, and don't reorder columns. Adding extra columns at the right is OK.
- **Stores**: add a row to add a store (`id` must be unique, e.g. `SIAM`). Set `active` to `FALSE` to hide one.
- **Staff**: to add a new hire before they open the app, add a row with a unique `id` (e.g. `ST-fah`), their `nickname` and `status` = `active`. They pick that name when they register.
- **ShiftTypes**: add or edit templates. Times can be typed as `08:30`. Changing a template does not rewrite shifts already scheduled.
- **Shifts**: you can edit `start`/`end` for one day, or add a row by hand. A row without an `id` still works.
- **Attendance_YYYY-MM**: one tab per month, created automatically. To fix a forgotten clock-out, add a row with `staff_id`, `type` = `OUT` and `timestamp` like `2026-11-19 17:30`.
- **Settings**: late grace, OT minimum, OT rounding and GPS accuracy limit.

The app reads the sheet on every request, so changes take effect immediately.

## Local development

See the README "Quick start". Tips:

- To keep test data out of the real sheet, put a different `SPREADSHEET_ID=...` in `worker/.dev.vars`; it overrides `wrangler.toml`.
- `GOOGLE_SA_JSON` in `.dev.vars` must be on one line:
  `node -e "console.log(JSON.stringify(require('./key.json')))"`
- To test the real LINE flow before GitHub Pages is ready, run `npm run dev` in `web/` and expose port 5173 over HTTPS (e.g. `cloudflared tunnel --url http://localhost:5173`). Then temporarily set that URL as the LIFF endpoint and add its origin to `ALLOWED_ORIGINS`.

## Troubleshooting

| Symptom | Fix |
|---|---|
| Browser console shows a CORS error | `ALLOWED_ORIGINS` must contain exactly `https://<user>.github.io` (no path, no slash); redeploy the Worker |
| "เข้าถึง Google Sheet ไม่ได้" | Share the sheet with the service account email as Editor; check `SPREADSHEET_ID` |
| "ยังไม่ได้ตั้งค่า Google Sheet" | Run the `/api/setup` curl command |
| "ยืนยันตัวตนกับ LINE ไม่สำเร็จ" | `LINE_CHANNEL_ID` must be the LINE **Login** channel that owns the LIFF app; LIFF scope `openid` must be on |
| Staff can't log in, only you can | Publish the LINE Login channel (step 3.5) |
| Blank page on GitHub Pages | Check the Actions log; the repo variables must be set; LIFF endpoint must match the Pages URL exactly |
| "ไม่ได้รับอนุญาตให้ใช้ตำแหน่ง" | Phone settings → LINE → Location → allow; turn on GPS |
| "สัญญาณ GPS ยังไม่แม่นยำพอ" | Both stores are indoors (hospital building, mall), where GPS is weaker. Turn on Wi-Fi (it improves location) or move near the entrance. If it keeps happening, raise `max_gps_accuracy_m` to 150 in Settings |
| Inside the store but "นอกพื้นที่" | Re-set the store location from inside the store, or increase its radius |
| Worker logs | `cd worker && npx wrangler tail` |

## Limits and costs

- **Cloudflare Workers (free plan):** 100,000 requests/day. This app uses roughly 100–300 a day.
- **Google Sheets API:** per-minute quotas are far above what 10 staff use.
- **GitHub Pages:** free for public repos.
- **LINE Login / LIFF:** free. This app sends no LINE messages, so the Official Account message quota isn't used.
- **Data growth:** about 600 attendance rows/month, each month in its own tab. `Shifts` is one tab (~300 rows/month). After a year or two, move old `Shifts` rows to an archive sheet if it feels slow.

## Security notes

- GPS can be spoofed by fake-location apps, and a web app can't fully prevent that. Every punch stores lat/lng, accuracy and distance, so the owner can audit them. If abuse appears, add a QR code at the counter or a selfie step.
- **PDPA:** the app stores staff names, phone numbers and the location at clock-in/out time only (no tracking in between). Tell staff this and get their consent. Keep the sheet shared only with the owner and the service account.
- Session tokens last 12 hours and are signed with `SESSION_SECRET`. Every request re-reads the `Staff` tab, so deactivating someone takes effect immediately.
- The owner code (`SETUP_KEY`) makes anyone who knows it an owner. Share it with nobody; rotate it with `wrangler secret put SETUP_KEY` after the owner registers.
