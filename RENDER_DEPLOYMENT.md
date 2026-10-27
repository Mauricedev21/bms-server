# Deploying the BMS backend to Render

Step-by-step guide for the Express/MongoDB backend in this folder (`server/`).
Placeholders look like `<this>` — replace them; never commit real credentials.

---

## 1. Prerequisites

- A **Render account** (https://render.com).
- A **MongoDB Atlas** cluster (Render's free tier has no databases — use Atlas
  free tier: `mongodb+srv://…`).
- The repo pushed to GitHub/GitLab (Render connects to it).
- The frontend (Vercel) URL, e.g. `https://salon-pro-manager.vercel.app`, so the
  API can allow it via CORS.

> Node requirement: **Node 20 or newer** (the scheduler uses node-cron 4.x).
> Set the Render "Node Version" to `20.x` or `22.x` (or add `"engines"` to
> `package.json`).

---

## 2. Create the Web Service

Render dashboard → **New → Web Service** → connect the repo, then use:

| Setting           | Value                          |
| ----------------- | ------------------------------ |
| Root Directory    | `server`                       |
| Runtime           | Node                           |
| Build Command     | `npm install && npm run build` |
| Start Command     | `npm start` (= `node dist/index.js`) |
| Health Check Path | `/api/health`                  |
| Instance Type     | Free (or higher)               |

`npm start` runs the compiled `dist/index.js`, which:

- reads `PORT` from the environment (Render sets it — do **not** hardcode),
- connects to MongoDB and **exits with code 1** if it cannot (Render shows the
  failure in Logs instead of serving a broken instance),
- starts the scheduled jobs **once**, after the HTTP server is listening,
- handles `SIGTERM`/`SIGINT` (Render sends SIGTERM on every deploy/restart) by
  stopping jobs → closing the server → disconnecting MongoDB → exit 0.

---

## 3. Environment variables (Render → Environment tab)

Set these in the Render dashboard (never commit them; `server/.env.example`
documents the same set for local use).

**Required**

| Key            | Value                                                            |
| -------------- | ---------------------------------------------------------------- |
| `NODE_ENV`     | `production`                                                     |
| `MONGODB_URI`  | your Atlas connection string, e.g. `mongodb+srv://user:pass@cluster.mongodb.net/bms?retryWrites=true&w=majority` |
| `JWT_SECRET`   | a long random string (e.g. `openssl rand -hex 32`) — the server **refuses to boot** in production without it |
| `CLIENT_ORIGIN`| `https://salon-pro-manager.vercel.app` (comma-separated if several)  |

**Recommended**

| Key                     | Value          | Meaning                                            |
| ----------------------- | -------------- | -------------------------------------------------- |
| `ALLOW_REGISTRATION`    | `true`/`false` | `false` locks public registration in production    |
| `RATE_LIMIT_WINDOW_MINUTES` | `15`       | API rate-limit window                              |
| `RATE_LIMIT_MAX`        | `300`          | Requests per window per IP                         |
| `DB_STORAGE_LIMIT_MB`   | `512`          | DB-usage widget quota (match your Atlas plan)      |
| `REDIS_URL`             | *(empty)*      | Optional cache; empty = automatic in-memory cache  |

**Scheduled jobs**

| Key                          | Value        | Meaning                                            |
| ---------------------------- | ------------ | -------------------------------------------------- |
| `MAINTENANCE_CRON`           | `0 0 * * *`  | Standard 5-field cron (minute hour dom month dow). Default `0 0 * * *` = daily at **00:00 UTC** (Render servers run UTC — adjust if you want e.g. 22:00 UTC = 00:00 Kigali, remember Rwanda has no DST). An invalid expression is logged and that job is skipped; the server still boots. |
| `RETENTION_SCHEDULED_ENABLED`| `true`       | `true` = one archive-then-remove pass per day (unchanged behaviour). `false` = the schedule only refreshes account-expiry notifications; retention can still be run manually by an admin via `POST /api/admin/retention/run`. |

The scheduled jobs **never modify or delete financial records** beyond the
documented retention behaviour (transactions/payments/loans older than
`RETENTION_MONTHS` are copied into `Archive` **first**, then removed; active
loans are never removed). All other jobs only read data and send notifications.

**Keep-alive (optional — read the limitation in §5 first)**

| Key                          | Value example                                    |
| ---------------------------- | ------------------------------------------------ |
| `KEEP_ALIVE_ENABLED`         | `false` (default)                                |
| `KEEP_ALIVE_URL`             | `https://<your-service>.onrender.com/api/health` (set **after** the first deploy, in the dashboard — never hardcode it in the repo) |
| `KEEP_ALIVE_INTERVAL_MINUTES`| `10` (clamped to 1..1440)                        |
| `KEEP_ALIVE_TIMEOUT_MS`      | `10000` (clamped to 1000..60000)                 |

While enabled, the server pings `KEEP_ALIVE_URL` every interval, logs success
or failure with a **sanitized** URL (credentials/query strings are stripped),
and applies the per-request timeout. Misconfigured values are reported at boot
and the pinger stays off — they can never crash the server.

---

## 4. Health check

```
GET https://<your-service>.onrender.com/api/health
```

Response (200 whenever the process is up):

```json
{
  "success": true,
  "data": {
    "status": "ok",
    "service": "bms-api",
    "environment": "production",
    "time": "2026-10-24T12:00:00.000Z",
    "uptimeSeconds": 42,
    "database": "connected",
    "scheduledJobs": { "count": 2, "enabled": 2, "running": 0 },
    "keepAlive": { "enabled": false }
  }
}
```

- Exposes **no** credentials, tokens, connection strings or config secrets.
- Mounted **before** the rate limiter, so uptime monitors can poll it as often
  as they like without ever receiving a 429.
- Render uses it as the service health-check path (§2).

---

## 5. Render free-tier sleep — the limitation you must know

Render **suspends free web services after ~15 minutes without external
traffic**, and a cold instance takes tens of seconds to boot again.

> **An internal job running inside this backend cannot wake the same backend
> after Render has suspended it.** `KEEP_ALIVE_*` only generates traffic
> *while the process is already awake* — it does **not** prevent sleep and
> does **not** guarantee availability. Treat it as an optional secondary
> measure, never as the uptime mechanism.

To keep the service responsive (or just to be notified when it is down), use
an **independent external** uptime monitor/scheduler — a separate service that
pings the public health URL from outside Render:

**Option A — cron-job.org (free, checks every 5 minutes)**

1. Sign up at https://cron-job.org → **Create cronjob**.
2. URL: `https://<your-service>.onrender.com/api/health`
3. Schedule: every 5 minutes (their free minimum).
4. Save → **Run now** once to verify (expect HTTP 200).

**Option B — UptimeRobot (free, 50 monitors, 5-minute checks)**

1. Sign up at https://uptimerobot.com → **Add New Monitor**.
2. Monitor Type: `HTTP(s)`; URL: `https://<your-service>.onrender.com/api/health`.
3. Monitoring Interval: 5 minutes → Create.

Either one alone keeps the instance warm (their ping counts as external
traffic) and also alerts you by email when the API is genuinely down. Because
the pings hit the un-rate-limited `/api/health`, frequent checks are safe.

---

## 6. Deploy, verify

1. Click **Deploy** (Render builds `npm install && npm run build`, then runs
   `npm start`).
2. Open **Logs** and confirm, in order:
   - `[db] MongoDB connected: …/bms`
   - `[jobs] scheduled subscription-notifications (0 0 * * *)`
   - `[jobs] scheduled retention-archiving (0 0 * * *)` (unless gated off)
   - `[keep-alive] started: …` (only if enabled)
3. Check the endpoint:
   ```
   curl https://<your-service>.onrender.com/api/health
   ```
   Expect `"status":"ok"`, `"database":"connected"`,
   `"scheduledJobs":{"count":2,…}`.
4. Subsequent pushes to the repo auto-deploy. Every deploy/restart sends
   `SIGTERM`; the server drains gracefully (jobs stopped → server closed →
   MongoDB disconnected → exit 0) before the old instance is replaced.

**Troubleshooting**

- *Boot loop / "JWT secret must be set in production"* → set `JWT_SECRET`.
- *Exit 1 + `[db] MongoDB connection failed`* → `MONGODB_URI` wrong, Atlas IP
  access list must include `0.0.0.0/0` (Render IPs change), or the cluster is
  paused.
- *Frontend gets CORS errors* → `CLIENT_ORIGIN` must exactly match the Vercel
  URL (scheme + host, no trailing slash).
- *`[jobs] … has invalid cron expression`* → fix `MAINTENANCE_CRON`; only that
  job is skipped, the API still runs.
- *Cold starts despite a monitor* → confirm the monitor's URL returns 200 (a
  monitor pointing at a wrong path still "wakes" nothing useful; check its own
  history/logs).

---

## 7. Run locally (development)

```bash
cd server
cp .env.example .env        # then edit values (MongoDB URI, secrets)
npm install
npm run dev                 # tsx watch → http://localhost:4000
```

Verification suites (both need a local MongoDB on `27017`; they use their own
discrete test databases — production data is never touched):

```bash
npm run check:jobs   # 109 checks: config validation, /api/health, scheduler,
                     # keep-alive, graceful shutdown, real child-process boot
npm run e2e          # full business workflow: auth → admin approval →
                     # transactions 60/40 → loans → reports → retention → admin
npm run build        # typecheck/compile to dist/
```
