# GridSync

Grid-aware EV trip planning for India: live charger availability, dynamic
time-of-use pricing, community-verified station status, and an operations
console for the people who keep the network running.

Vanilla JS single-page app + one zero-dependency Vercel serverless function.
No build step, no framework, no runtime dependencies.

## Running locally

```bash
npm install
cp .env.example .env.local   # then fill in the keys you have
node server.js               # http://localhost:3000
```

Every integration is optional. With no keys at all the app still runs: grid
telemetry falls back to simulated SLDC data, Open Charge Map works
unauthenticated at a lower quota, and persistence falls back to a local file
store. The one exception is the map itself — `GOOGLE_MAPS_API_KEY` is required
for anything cartographic to render.

| Variable | Purpose | Required |
| --- | --- | --- |
| `SESSION_SECRET` | Signs session tokens. Without it, sessions reset on every cold start. | Yes, in production |
| `GOOGLE_MAPS_API_KEY` | Maps, Places, Directions, Geocoding | Yes |
| `OCM_API_KEY` | Open Charge Map station database | No |
| `ATLAS_API_KEY` | India Energy Atlas live grid demand/frequency | No |
| `SUPABASE_URL` / `SUPABASE_KEY` | Durable persistence (`service_role` key) | No |

`GET /api/health` reports which integrations are actually wired up on a
running deployment.

## Persistence

Without Supabase, state lives in a JSON file under `os.tmpdir()` — fine for
local development, but wiped on every serverless cold start. For anything
durable, create a Supabase project, run [`supabase/schema.sql`](supabase/schema.sql)
in its SQL editor, set `SUPABASE_URL`/`SUPABASE_KEY`, then seed the demo
accounts:

```bash
node scripts/seed-supabase.js
```

## Demo accounts

| Role | Email | Password |
| --- | --- | --- |
| Driver | `user@gridsync.in` | `user123` |
| Operator | `admin@gridsync.in` | `admin123` |

These are seeded fixtures for evaluating the app. Change them before putting
this anywhere real.

## Architecture

See [`CLAUDE.md`](CLAUDE.md) for the full reference: the four data pipelines,
the auth model, endpoint-by-endpoint permissions, and the conventions worth
preserving.

The short version:

- **Station fusion** — Open Charge Map POIs, live Google Places connector
  availability, admin overrides and community reports merge into one
  `allStations` list, each entry tagged with how much its status can be trusted.
- **Grid-aware recommendation** — live demand/frequency become a 0–1 stress
  index that feeds a hand-coded 6-8-1 scoring network and drives dynamic pricing.
- **Community trust loop** — driver 👍/👎 reports flow into an operator ops
  queue, and back out as station status the recommender respects.
- **Impact analytics** — logged diversions become estimated kWh routed, CO₂
  avoided and revenue directed to operators. These are *estimates* derived from
  documented constants, not metered readings, and the UI says so.

## Deploying

```bash
npx vercel --prod
```

Set the environment variables in the Vercel project first. Restrict the Google
Maps key by HTTP referrer — Maps JS keys are always visible to the browser.
