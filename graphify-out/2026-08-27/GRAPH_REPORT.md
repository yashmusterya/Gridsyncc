# Graph Report - GridSync-ll  (2026-08-27)

## Corpus Check
- 16 files · ~33,685 words
- Verdict: corpus is large enough that graph structure adds value.

## Summary
- 333 nodes · 671 edges · 16 communities (15 shown, 1 thin omitted)
- Extraction: 94% EXTRACTED · 6% INFERRED · 0% AMBIGUOUS · INFERRED: 38 edges (avg confidence: 0.9)
- Token cost: 0 input · 0 output

## Graph Freshness
- Built from commit: `803ac488`
- Run `git rev-parse HEAD` and compare to check if the graph is stale.
- Run `graphify update .` after code changes (no API cost).

## Community Hubs (Navigation)
- script.js
- handler.js
- index.html - single-page shell (login, user app, admin console)
- auth.js
- package.json
- EV Profile Setup Modal - make-then-model cascade (#vehicle-setup-modal)
- GET /api/grid-demand
- logChargerDiversion
- syncDatabaseState
- Home / Map Tab (#panel-home)
- GridSync — architecture quick reference
- server.js
- evaluateStationWithML
- vercel.json
- GET /api/ocm-chargers
- sw.js

## God Nodes (most connected - your core abstractions)
1. `planTrip()` - 21 edges
2. `initMap()` - 19 edges
3. `supabaseRequest()` - 18 edges
4. `readStore()` - 18 edges
5. `index.html - single-page shell (login, user app, admin console)` - 18 edges
6. `ensureSeeded()` - 17 edges
7. `supabaseEnabled()` - 16 edges
8. `writeStore()` - 15 edges
9. `plotMarkers()` - 13 edges
10. `mergeLiveGooglePlaces()` - 12 edges

## Surprising Connections (you probably didn't know these)
- `renderPricingMetrics()` --references--> `Grid & Pricing Tab (#panel-pricing)`  [INFERRED]
  script.js → index.html
- `renderProfileDetails()` --references--> `Profile Tab incl. Your GridSync Impact card (#panel-profile)`  [INFERRED]
  script.js → index.html
- `loadMyImpact()` --references--> `Profile Tab incl. Your GridSync Impact card (#panel-profile)`  [INFERRED]
  script.js → index.html
- `Trip Planner Tab (#panel-plan)` --references--> `toggleSimulator()`  [EXTRACTED]
  index.html → script.js
- `loadAdminDashboard()` --references--> `Admin Overview incl. Impact dashboard + trend chart (#admin-panel-dash)`  [INFERRED]
  script.js → index.html

## Import Cycles
- None detected.

## Hyperedges (group relationships)
- **Impact Dashboard Data Flow** — script_logchargerdiversion, api_analytics_event, supabase_analytics_events_table, api_analytics_summary, script_loadimpactdashboard, api_analytics_me, script_loadmyimpact [EXTRACTED 1.00]
- **Make-First Vehicle Setup Flow** — index_vehicle_setup_modal, script_openvehiclesetupmodal, script_handlesetupmakechange, script_populatemodeloptions, script_handlesetupmodelchange, script_handlesavevehicleprofile, api_user_vehicle, ev_models_dataset [EXTRACTED 1.00]
- **Persistence Layer (Supabase-first, file-backed fallback)** — api_handler_supabaserequest, lib_store_readstore, lib_store_writestore, api_handler_ensureseeded, supabase_users_table [EXTRACTED 1.00]

## Communities (16 total, 1 thin omitted)

### Community 0 - "script.js"
Cohesion: 0.06
Nodes (72): activeRouteInfo, adminAuditEntries, allStations, apiFetch(), applyOverridesAndReports(), applyUserVehicleToInputs(), buildMergedStation(), calculateBestRecommendation() (+64 more)

### Community 1 - "handler.js"
Cohesion: 0.07
Nodes (61): POST /api/admin/charger/update, GET /api/admin/overrides, POST /api/admin/station/update, GET /api/analytics/me, GET /api/analytics/summary, POST /api/auth/login, POST /api/auth/register, GET /api/get-saved-trips (+53 more)

### Community 2 - "index.html - single-page shell (login, user app, admin console)"
Cohesion: 0.06
Nodes (41): GET /api/config, GOOGLE_MAPS_API_KEY, Admin App Shell (#admin-app-shell), Admin System Analytics (#admin-panel-analytics), Admin Overview incl. Impact dashboard + trend chart (#admin-panel-dash), Admin Live Control Map (#admin-panel-map), Admin Manage Stations (#admin-panel-stations), Bottom Navigation (#bottom-navigation) (+33 more)

### Community 3 - "auth.js"
Cohesion: 0.13
Nodes (17): requireAdmin(), requireAuth(), sendJson(), b64url(), b64urlDecode(), crypto, getAuthContext(), getSecret() (+9 more)

### Community 4 - "package.json"
Cohesion: 0.12
Nodes (15): author, description, devDependencies, vercel, vercel, keywords, license, main (+7 more)

### Community 5 - "EV Profile Setup Modal - make-then-model cascade (#vehicle-setup-modal)"
Cohesion: 0.27
Nodes (11): GET /api/ev-makes, GET /api/ev-vehicles, evModels, ev_models.json - Indian-market EV catalogue, split into {make, model, modelFull, ...}, EV Profile Setup Modal - make-then-model cascade (#vehicle-setup-modal), cachedEvModels, window.handleSaveVehicleProfile(), window.handleSetupMakeChange() (+3 more)

### Community 6 - "GET /api/grid-demand"
Cohesion: 0.31
Nodes (11): GET /api/epa/makes, GET /api/epa/models, GET /api/epa/specs, US EPA fueleconomy.gov REST - vehicle spec lookup (unused by current UI), Graceful Degradation Pattern (Supabase -> file-backed store -> never a 5xx), GET /api/grid-demand, ATLAS_API_KEY (India Energy Atlas), extractMenuItems() (+3 more)

### Community 7 - "logChargerDiversion"
Cohesion: 0.17
Nodes (14): POST /api/analytics/event, Login Screen (#login-screen, User/Admin roles), Profile Tab incl. Your GridSync Impact card (#panel-profile), activeUser (session identity), activeWaypoint (charger stopover), window.addChargerStopover(), window.handleAuthLogin(), window.handleAuthLogout() (+6 more)

### Community 8 - "syncDatabaseState"
Cohesion: 0.29
Nodes (6): Admin Station Edit Modal (#admin-edit-station-modal), adminOverrides, communityReports, window.overrideChargerStatus(), window.saveAdminStationEdit(), syncDatabaseState()

### Community 9 - "Home / Map Tab (#panel-home)"
Cohesion: 0.33
Nodes (3): Home / Map Tab (#panel-home), chargerTypeFilter / activeOnly / filter247Only, window.toggleFilterPill()

### Community 10 - "GridSync — architecture quick reference"
Cohesion: 0.11
Nodes (17): Admin console (Overview · Ops Queue · Live Control Map · Manage Stations · Analytics), Auth model (added after the endpoints above were originally written), Conventions to preserve, Files, graphify, GridSync — architecture quick reference, PWA, Resolved (kept here so a regression is recognizable) (+9 more)

### Community 11 - "server.js"
Cohesion: 0.24
Nodes (8): apiHandler, appHandler(), createAndStartServer(), fs, http, MIME_TYPES, path, url

### Community 12 - "evaluateStationWithML"
Cohesion: 0.43
Nodes (3): evaluateStationWithML(), 6-8-1 MLP Recommendation Network (hardcoded weights), StationRecommendationMLP

### Community 13 - "vercel.json"
Cohesion: 0.33
Nodes (5): maxDuration, functions, api/handler.js, headers, rewrites

### Community 14 - "GET /api/ocm-chargers"
Cohesion: 0.50
Nodes (4): OCM_API_KEY (Open Charge Map), GET /api/ocm-chargers, Open Charge Map API (api.openchargemap.io/v3/poi) - static charger POIs, fetchAllIndiaChargers()

## Knowledge Gaps
- **73 isolated node(s):** `https`, `fs`, `path`, `url`, `{ hashPassword, verifyPassword, signToken, getAuthContext }` (+68 more)
  These have ≤1 connection - possible missing edges or undocumented components.
- **1 thin communities (<3 nodes) omitted from report** — run `graphify query` to explore isolated nodes.

## Suggested Questions
_Questions this graph is uniquely positioned to answer:_

- **Why does `index.html - single-page shell (login, user app, admin console)` connect `index.html - single-page shell (login, user app, admin console)` to `syncDatabaseState`, `Home / Map Tab (#panel-home)`, `EV Profile Setup Modal - make-then-model cascade (#vehicle-setup-modal)`, `logChargerDiversion`?**
  _High betweenness centrality (0.089) - this node is a cross-community bridge._
- **Why does `syncDatabaseState()` connect `syncDatabaseState` to `script.js`, `handler.js`?**
  _High betweenness centrality (0.061) - this node is a cross-community bridge._
- **Why does `GET /api/reports/summary` connect `handler.js` to `syncDatabaseState`, `index.html - single-page shell (login, user app, admin console)`?**
  _High betweenness centrality (0.061) - this node is a cross-community bridge._
- **What connects `https`, `fs`, `path` to the rest of the system?**
  _73 weakly-connected nodes found - possible documentation gaps or missing edges._
- **Should `script.js` be split into smaller, more focused modules?**
  _Cohesion score 0.05925925925925926 - nodes in this community are weakly interconnected._
- **Should `handler.js` be split into smaller, more focused modules?**
  _Cohesion score 0.06832298136645963 - nodes in this community are weakly interconnected._
- **Should `index.html - single-page shell (login, user app, admin console)` be split into smaller, more focused modules?**
  _Cohesion score 0.05555555555555555 - nodes in this community are weakly interconnected._