# ZenMeasure Tag Monitor Operations

This is the handoff anchor for the Bluetooth temperature tag lookup app.

## Project Guard

- Workspace: `D:\Data\GitHub\Tag-App2Web`
- Product: ZenMeasure Bluetooth temperature tag lookup
- Frontend: Vite + React
- Worker: Cloudflare Worker `tag-monitor-api`
- Supabase project name: `tag-app2web`
- Supabase project ref: `irwnulzddzfcwncqsabn`
- Supabase URL: `https://irwnulzddzfcwncqsabn.supabase.co`
- Supabase account: `patrick@zenmeasure.com`
- Data: Supabase tables in `supabase/schema.sql`
- MQTT ingest: `scripts/mqtt_to_supabase.mjs`

Do not reuse GEO-radar project refs, Worker names, Pages names, or database refs. GEO-radar is reference material only.

## Temporary Supabase Project To Delete

Patrick uses a separate Supabase account for this app.

The following project was created in the existing paid organization for early setup only and has now been manually deleted by Patrick:

- Project name: `zenmeasure-tag-monitor`
- Project ref: `fwnwoydhhewbowddfyzl`
- Region: `ap-northeast-1`
- Created on: 2026-07-02
- Deleted manually by Patrick: 2026-07-02

The new project is already ready:

- Project name: `tag-app2web`
- Project ref: `irwnulzddzfcwncqsabn`
- Schema applied: 2026-07-02
- Advisors: no issues found

Deletion status as of 2026-07-02: complete.

## Production Domain

Cloudflare has the `zenmeasure.space` zone. The intended production hostname is:

```text
https://tag.zenmeasure.space
```

Cloudflare Pages deployment:

- Pages project: `tag-app2web`
- Latest deployment checked: `30002ea4`
- Deployment URL: `https://30002ea4.tag-app2web.pages.dev`
- Custom domain binding: `tag.zenmeasure.space`
- Status on 2026-07-02: Pages deployed, custom domain active
- DNS status on 2026-07-02: `tag.zenmeasure.space` is active in Cloudflare Pages and serves the app with HTTP 200.
- DNS note: `tag.zenmeasure.space` is configured through Cloudflare DNS to route to `tag-app2web.pages.dev`. Public recursive DNS may show Cloudflare A/AAAA edge addresses when proxying is enabled; that is expected.
- CLI DNS helper: `npm run configure:dns` deletes existing `tag` A/AAAA/CNAME records and creates `CNAME tag.zenmeasure.space -> tag-app2web.pages.dev` when `CLOUDFLARE_API_TOKEN` has Zone DNS Edit permission.

Deploy without Wrangler:

```powershell
npm run build
npm run deploy:pages:api
```

Preferred Pages deploy with Wrangler on this Windows machine:

```powershell
npm run build
npx wrangler pages deploy ../../dist --project-name tag-app2web --cwd cloudflare/pages
```

Do not wrap this Wrangler command in `npm run` on this machine; npm's local binary wrapper can trigger `spawn EPERM`.

## Auth Model

Supabase Magic Link proves identity. Authorization is separate:

- Internal domains: `miaomiaoce.com`, `zenmeasure.com`, `zenmeasure.space`
- Customer emails: `customer_email_allowlist`
- Customer tag visibility: `tag_access`
- Row-level security: all public tables have RLS enabled
- Worker precheck: `/api/auth/check-email` prevents sending links to emails that are neither internal nor allowlisted

GEO-radar SMTP pattern:

- SMTP host: `gsgpm1049.siteground.biz`
- SMTP port: `465`
- SMTP admin email: `support@zenmeasure.com`
- Sender name: `ZenMeasure Support`
- Password source: local secret `ZENMEASURE_SMTP_PASS`, never commit it

## Local Setup

```powershell
npm install
Copy-Item .env.example .env.local
npm run dev -- --host 127.0.0.1 --port 5173
```

Fill `.env.local` with the Supabase URL and publishable/anon key.

## Supabase Setup

Create or link a Supabase project, then run:

```powershell
supabase db query --linked --file supabase/schema.sql
```

For production Magic Link, configure Supabase Auth:

- Site URL: your production web URL
- Redirect URLs: production URL, production wildcard, localhost URL
- Custom SMTP: use the GEO-radar SMTP settings above

Auth URL status on 2026-07-02:

- Site URL: `https://tag.zenmeasure.space`
- Redirect allow list: `https://tag.zenmeasure.space`, `https://tag.zenmeasure.space/**`, `https://tag-app2web.pages.dev`, `https://tag-app2web.pages.dev/**`, local Vite URLs
- Updated through Supabase Management API because the previous value was `http://localhost:3000`, which caused Magic Link callbacks to open localhost.
- Sales Radar email pattern copied on 2026-07-02: Magic Link remains Supabase Auth email. Production should configure Supabase Auth with ZenMeasure SMTP. Use `npm run configure:auth-email` after setting local secret `ZENMEASURE_SMTP_PASS`.

Supabase changelog note checked on 2026-07-02: tables created by SQL may not be exposed to the Data API automatically. `schema.sql` includes explicit grants and RLS policies.

## MQTT Ingest

MQTT parameters provided by Patrick:

- Server: `mqtt://67.218.141.193:1883`
- Topic: `mmc/mot_g802/#`

Keep username, password, and Supabase service role key in environment variables or the server-only `.env.ingest` file only. Never commit `.env.ingest`.

```powershell
$env:MQTT_URL="mqtt://67.218.141.193:1883"
$env:MQTT_USERNAME="..."
$env:MQTT_PASSWORD="..."
$env:MQTT_TOPIC="mmc/mot_g802/#"
$env:SUPABASE_URL="https://your-project.supabase.co"
$env:SUPABASE_SERVICE_ROLE_KEY="..."
npm run mqtt:ingest
```

The ingest script accepts JSON payloads and simple `key=value` payloads. It looks for tag fields such as `tag_code`, `tag_id`, `mac`, `device_id`, and temperature fields such as `temperature_c`, `temperature`, `temp`, or `t`.

### Ubuntu PM2 Service

For a small Ubuntu server such as an OpenClaw host, run the ingest service with PM2:

```bash
git clone https://github.com/liangyuyang/Tag-App2Web.git
cd Tag-App2Web
npm install
cp .env.ingest.example .env.ingest
nano .env.ingest
npm install -g pm2
pm2 start npm --name tag-app2web-mqtt -- run mqtt:ingest
pm2 save
pm2 startup
```

Check and manage the service:

```bash
pm2 status
pm2 logs tag-app2web-mqtt
pm2 restart tag-app2web-mqtt
```

## Build

```powershell
npm run lint
npm run build
```
