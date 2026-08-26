## graphify

This project has a knowledge graph at graphify-out/ with god nodes, community structure, and cross-file relationships.

Rules:
- For codebase questions, first run `graphify query "<question>"` when graphify-out/graph.json exists. Use `graphify path "<A>" "<B>"` for relationships and `graphify explain "<concept>"` for focused concepts. These return a scoped subgraph, usually much smaller than GRAPH_REPORT.md or raw grep output.
- If graphify-out/wiki/index.md exists, use it for broad navigation instead of raw source browsing.
- Read graphify-out/GRAPH_REPORT.md only for broad architecture review or when query/path/explain do not surface enough context.
- After modifying code, run `graphify update .` to keep the graph current (AST-only, no API cost). The route handlers, `window.*` wiring, and cross-file edges below are hand-authored in the semantic layer, not AST-derived — a plain `graphify update .` will refresh AST nodes but won't add hand-authored edges for anything new you build. Re-run the full pipeline (or extend it by hand) for a change that adds new endpoints/handlers.

---

# GridSync — architecture quick reference

Vanilla JS SPA + a single zero-dependency Vercel serverless function. No build step, no framework.
`vercel dev` (run directly — **do not** add a `"dev": "vercel dev"` npm script; Vercel's CLI refuses to start with "must not recursively invoke itself" if package.json's own dev script is that literal string) → serves `index.html` statically; `vercel.json` rewrites every `/api/*` request to `api/handler.js`.
Persistence is Supabase (Postgres via PostgREST) when `SUPABASE_URL`/`SUPABASE_KEY` are configured — see `supabase/schema.sql` — with a file-backed fallback store (`lib/store.js`) for offline/local use.

## Files
| File | Role |
|---|---|
| `api/handler.js` | Single Vercel serverless function: all JSON endpoints (auth, trips, reports, admin overrides, analytics/impact, grid/OCM/EPA/VAHAN proxies). No express, no deps. |
| `lib/auth.js` | Password hashing (Node `crypto.scrypt`), shared by `api/handler.js` and `scripts/seed-supabase.js`. |
| `lib/store.js` | File-backed fallback store (`os.tmpdir()`), used only when Supabase isn't configured. See "Conventions" below — this is not `global.*` for a specific, tested reason. |
| `supabase/schema.sql` | Table definitions (`users`, `saved_trips`, `reports`, `station_overrides`, `charger_overrides`, `analytics_events`) — run once in the Supabase SQL Editor. |
| `scripts/seed-supabase.js` | One-time `node scripts/seed-supabase.js` to seed the two demo accounts into Supabase with hashed passwords. |
| `script.js` (~3900 L) | Entire front-end. ~50 top-level functions + ~35 `window.*` handlers wired by inline `onclick`. |
| `index.html` (~890 L) | Single page: login screen, user shell (4 tabs incl. Impact card on Profile), admin shell (4 tabs incl. Impact dashboard on Overview), 4 modals. |
| `style.css` (~3900 L) | Dark "glass" design system + a `@media (max-width:768px)` mobile layer (admin shell, touch targets, safe-area insets, 16px input floor). |
| `ev_models.json` | Indian-market EV catalogue, one entry per `{make, model, modelFull, batteryCapacity, maxRange, connector, preferenceSpeed}` → `/api/ev-makes`, `/api/ev-vehicles?make=`. |
| `vahan_registry.json` | Simulated VAHAN registration lookup → `/api/vahan/vehicle`. |
| `__MACOSX/` | AppleDouble zip junk. Ignore; safe to delete. |

## Two shells, one page
- `#login-screen` → role toggle User/Admin → `handleAuthLogin()` → reveals `#user-app-shell` **or** `#admin-app-shell`.
- User tabs: Home/Map · Plan · Pricing · Profile (`switchUserTab`) — Profile carries the driver's personal "Your GridSync Impact" card.
- Admin tabs: Overview · Live Control Map · Manage Stations · Analytics (`switchAdminTab`) — Overview leads with the fleet-wide Impact dashboard (diversions, est. kWh/CO2/revenue, 14-day trend chart, top diverted-to stations).

## The four pipelines that matter

**1. Station data fusion** — `fetchAllIndiaChargers` → `/api/ocm-chargers` (static OCM POIs) → `buildMergedStation`; then `fetchGooglePlacesForViewport` hits Google Places v1 directly from the browser for *live connector availability* → `mergeLiveGooglePlaces` → `applyOverridesAndReports` layers admin overrides + community reports on top → `allStations` → `plotMarkers`. Each station carries a `trustType` (LIVE / STATIC / PREDICTED / USER REPORTED) rendered by `getTrustBadgeHTML`.

**2. Grid-aware recommendation** — `/api/grid-demand` proxies India Energy Atlas (demand MW + frequency Hz) → `getGridStressIndex()` normalizes to 0–1 (50% demand ratio, 50% frequency deficit) → feeds a **hand-coded 6-8-1 MLP** (`StationRecommendationMLP`; ReLU hidden, sigmoid out, weights are literals — nothing is trained) → `evaluateStationWithML` → `calculateBestRecommendation` picks `recommendedStation` within the SOC/reserve range envelope. Same stress index drives `getStationGridLoadAndPrice` (AC ₹5.5 / DC ₹11.5 base × 1.0–1.65 multiplier).

**3. Community trust loop** — driver taps 👍/👎 in an info window → `submitChargerReport` → `/api/reports/add` (Supabase `reports` table, file-backed fallback) → `/api/reports/summary` → `syncDatabaseState` → `applyOverridesAndReports` marks `communityFault` → that flips the MLP's `availability` input to 0. Admin `overrideChargerStatus` / `saveAdminStationEdit` feed the same merge via `/api/admin/*`.

**4. Impact / sustainability analytics** — `logAnalyticsEvent(type, stationId, metadata)` fires `session_start` (login), `route_planned` (`planTrip` success), and `charger_diverted` (`addChargerStopover` / `selectStationAsDestination`'s direct-route branch, via `logChargerDiversion`) to `POST /api/analytics/event` → `analytics_events` table (Supabase) or file-backed fallback. `GET /api/analytics/summary` (admin, fleet-wide) and `GET /api/analytics/me?email=` (driver, personal) both derive estimated kWh/CO2-avoided/₹-to-operators from `charger_diverted` events using constants documented at the top of `api/handler.js` (`AC_SESSION_KWH_ESTIMATE`, `DC_SESSION_KWH_ESTIMATE`, `FLEET_KM_PER_KWH`, `PETROL_G_CO2_PER_KM`, `GRID_KG_CO2_PER_KWH`) — these are estimates, not metered readings, and both response payloads say so (`dataSource: "SUPABASE" | "SESSION_ONLY"`).

## Server endpoints (`api/handler.js`)
Public `/api/config` `/api/health` `/api/grid-demand` `/api/ocm-chargers` `/api/auth/login` `/api/auth/register` `/api/predict_arrival` `/api/ev-makes` `/api/ev-vehicles[?make=]` `/api/vahan/vehicle` `/api/reports/summary` `/api/analytics/event` · EPA `/api/epa/makes` `/api/epa/models` `/api/epa/specs` (unused by current UI — dead but functional)

**Auth-required** (`requireAuth`): `/api/save-trip` `/api/get-saved-trips` `/api/user/vehicle` `/api/reports/add` `/api/analytics/me` `/api/admin/overrides`
**Admin-only** (`requireAdmin`): `/api/admin/station/update` `/api/admin/charger/update` `/api/admin/ops-queue` `/api/admin/reports/resolve` `/api/admin/audit` `/api/admin/analytics` `/api/analytics/summary`

## Auth model (added after the endpoints above were originally written)
- Login/register return an **HMAC-SHA256 signed session token** (`lib/auth.js` `signToken`/`verifyToken`, compact `<base64url payload>.<base64url sig>`, 12h TTL). Signed with `SESSION_SECRET`; without that env var the server generates a random per-process secret, so sessions die on every cold start (deliberate — never fall back to a constant).
- The client keeps the token in `localStorage` under `gridsync.session` and sends it via **`apiFetch()` in `script.js`** — every `/api/*` call goes through that one wrapper, which attaches the bearer header and, on a 401, clears the session and returns the user to login. Don't call bare `fetch()` for an API route.
- **Identity is always read from the token, never the request body.** `/api/user/vehicle`, `/api/analytics/me`, `/api/reports/add` and `/api/save-trip` all ignore any client-supplied email and use `auth.email`. Before this, any signed-in driver could overwrite another's vehicle profile or read their impact stats by changing a parameter.
- Failed logins are throttled (8 per email per 10 min → 429), and unknown-user vs wrong-password return an identical message so accounts can't be enumerated.
- Every admin mutation writes an **audit entry** (`recordAudit`) surfaced in the Analytics tab.

## Admin console (Overview · Ops Queue · Live Control Map · Manage Stations · Analytics)
- **Ops Queue** is the working surface: `buildOpsQueue` groups community reports per station, scores severity from `broken - working` (CRITICAL ≥3 / HIGH 2 / MEDIUM 1), and carries triage state `open → acknowledged → resolved`. A station reported broken *after* its resolution timestamp **auto-reopens** — resolutions don't silently bury a recurring fault.
- Overview's "Needs Attention" widget and the nav badge are painted from that same queue; the old flat read-only report table is gone.
- `refreshAdminData()` re-pulls everything on a 60s timer (paused while the tab is hidden) and on the manual refresh button; `markAdminSynced()` drives the header's synced-at indicator.
- Manage Stations is **paginated at 50 rows** — the OCM feed is ~1950 stations and rendering them all froze the tab. Status filtering uses the OCM `status` field, *not* `availableCount` (live connector counts only exist for stations Google Places has been queried for, so an availability filter matched nothing fleet-wide).
- Ops queue, audit trail and the stations table all export CSV via `downloadCsv()`.
- **`escapeHtml()` is mandatory** for any station/operator/user text interpolated into admin `innerHTML` — those strings come from OCM and from admin edits, i.e. outside this app.

## PWA
`manifest.webmanifest` + `sw.js` + `offline.html`, icons generated into `icons/`. The service worker caches the **app shell only and never `/api/*`** — a stale cached charger status would send a driver to an occupied or broken station. Navigations are network-first, static assets cache-first.

## Conventions to preserve
- **Graceful degradation everywhere.** Every external/DB call has a simulated or local fallback and returns 200 — the UI never sees a 5xx. `/api/grid-demand` fakes 19–25 GW; every Supabase-backed endpoint falls back to the file-backed store on any Supabase error or when `SUPABASE_URL`/`SUPABASE_KEY` aren't set; EPA falls back to `LOCAL_EPA_FALLBACK`.
- **Supabase is the persistence layer; the fallback is file-backed, not `global.*`.** `global.*` does **not** reliably survive between requests under `vercel dev` local emulation — confirmed by testing (a `POST /api/reports/add` followed immediately by `GET /api/reports/summary` came back empty every time). `lib/store.js` reads/writes a JSON file in `os.tmpdir()` at the top of every request instead. This does not make the fallback durable on real serverless production (`/tmp` is still wiped on cold start there) — it only fixes local dev and any non-ephemeral host. Don't reintroduce `global.inMemory*` for new endpoints; use `store.<field>` (see `ensureSeeded`/`readStore`/`writeStore` in `api/handler.js`) and call `writeStore(store)` after every mutation.
- **Passwords are hashed with Node's built-in `crypto.scrypt`** (`lib/auth.js`), not plaintext. Stored format: `scrypt:<salt>:<hash>`.
- **Secrets are server-side except one.** Atlas/OCM/Supabase keys come from `process.env`. The Google Maps key is fetched by the client from `/api/config` and injected into a dynamically-created `<script>` tag (`index.html`) rather than hardcoded — still publicly visible by design (Maps JS keys always are; restrict by HTTP referrer in Google Cloud Console), but at least sourced from server env instead of committed to source.
- **Handlers must be `window.*`** to be reachable from inline `onclick` generated in `index.html`. Handlers only ever invoked from markup `script.js` itself generates via template literals (`onclick="fn('${id}')"` strings) work as plain top-level `function` too, since `script.js` is loaded as a classic (non-module) script and top-level function declarations become `window` properties automatically — but the codebase's convention is `window.foo = function(...)` for anything reachable from static `index.html`, so follow that split for new handlers.
- **Mobile is a real target, not an afterthought.** `style.css`'s `@media (max-width: 768px)` layer specifically covers what the (already mobile-first) base styles didn't: the admin console (horizontally-scrolling nav, stacked stats, scrollable tables), 44px+ touch targets, and a 16px input-font floor (iOS Safari auto-zooms below that). `--safe-top`/`--safe-bottom` custom properties (from `env(safe-area-inset-*)`) are threaded through `#bottom-navigation` and `.bottom-sheet-panel` for notched devices. New fixed-position chrome should use those variables, not bare pixel offsets.
- **Car selection is make-first.** `ev_models.json` entries carry `{make, model, modelFull}` — `model` is the short display name (cascade dropdown), `modelFull` is `"{make} {model}"` and is what gets stored server-side as `user.vehicleModel` (keeps existing display/VAHAN-matching code working unchanged). `populateModelOptions(make)` filters the already-fully-fetched `cachedEvModels` client-side rather than a second network round-trip per company change.

## Resolved (kept here so a regression is recognizable)
- The admin shell never called `initMap()`, and `allStations` is only populated by `loadInitialData()` inside it — so the entire admin console (every station KPI, Manage Stations, the Live Control Map, both station charts) rendered zeroes and an empty map for operators. `enterAppAsUser()` now initialises the map for admins too, and skips `startGeolocationTracking()` for them.
- `/api/admin/*` had **no authentication at all** — anyone who knew the URL could rewrite station metadata on the live deployment — and "Admin" was purely a client-side flag the browser set on itself.
- The login form's `catch` used to accept the demo credentials client-side when the API was unreachable, handing out an Admin shell with no server-issued token (a client-side auth bypass). Authentication is now always the server's decision.
- The "Sign in with Google" button showed a fake "Verifying with Google Accounts / Exchanging OAuth 2.0 credentials" overlay while actually signing into the built-in demo account. No Google OAuth exists in this app; it is now labelled "Quick sign-in as demo driver".
- A GPS fix arriving before the dynamically-injected Maps script finished loading threw `Cannot read properties of undefined (reading 'travelMode')`; the geolocation ETA path now checks `isMapsApiReady()` alongside `directionsService`.
- `index.html` used to call `toggleSimulationDrive()`, which was never defined — only `toggleSimulator()` existed. Fixed by correcting the `onclick` target.
- `package.json` used to declare `"dev": "vercel dev"`, which trips Vercel CLI's self-recursion guard regardless of invocation path and blocked all local dev. Removed; run `vercel dev` directly.
- `/api/predict_arrival` is not a model — it is an if/else on arrival hour. `StationRecommendationMLP`'s weights are hardcoded constants; "prediction" is a fixed scoring function. Both intentional simplifications for this app's scope, not bugs — noted here so they aren't mistaken for missing functionality.
