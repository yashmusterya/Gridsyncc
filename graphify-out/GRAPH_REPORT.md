# Graph Report - GridSync-ll  (2026-08-26)

## Corpus Check
- Corpus is ~24,532 words - fits in a single context window. You may not need a graph.

## Summary
- 253 nodes · 530 edges · 15 communities (14 shown, 1 thin omitted)
- Extraction: 94% EXTRACTED · 6% INFERRED · 0% AMBIGUOUS · INFERRED: 34 edges (avg confidence: 0.91)
- Token cost: 0 input · 0 output

## Community Hubs (Navigation)
- Map, Route & Station Rendering
- Backend Route Handlers & Analytics Core
- App Shell, Auth UI & Admin Console
- Password Hashing & Supabase Seed Script
- NPM Package Manifest
- Make-First Vehicle Cascade & EV Profile
- EPA/Atlas External APIs & Grid Stress
- Auth Session & Login Flow
- Admin Station Edit & Overrides
- Home Tab Map Filters & Search
- Trip Planner SOC/Range Inputs
- File-Backed Fallback Store
- MLP Recommendation Network
- Vercel Deployment Config
- Open Charge Map Data Source

## God Nodes (most connected - your core abstractions)
1. `planTrip()` - 20 edges
2. `readStore()` - 18 edges
3. `index.html - single-page shell (login, user app, admin console)` - 18 edges
4. `ensureSeeded()` - 17 edges
5. `initMap()` - 17 edges
6. `supabaseRequest()` - 14 edges
7. `plotMarkers()` - 13 edges
8. `supabaseEnabled()` - 12 edges
9. `writeStore()` - 12 edges
10. `mergeLiveGooglePlaces()` - 12 edges

## Surprising Connections (you probably didn't know these)
- `renderPricingMetrics()` --references--> `Grid & Pricing Tab (#panel-pricing)`  [INFERRED]
  script.js → index.html
- `Profile Tab incl. Your GridSync Impact card (#panel-profile)` --references--> `window.handleAuthLogout()`  [EXTRACTED]
  index.html → script.js
- `renderProfileDetails()` --references--> `Profile Tab incl. Your GridSync Impact card (#panel-profile)`  [INFERRED]
  script.js → index.html
- `loadMyImpact()` --references--> `Profile Tab incl. Your GridSync Impact card (#panel-profile)`  [INFERRED]
  script.js → index.html
- `Trip Planner Tab (#panel-plan)` --references--> `toggleSimulator()`  [EXTRACTED]
  index.html → script.js

## Import Cycles
- None detected.

## Hyperedges (group relationships)
- **Impact Dashboard Data Flow** — script_logchargerdiversion, api_analytics_event, supabase_analytics_events_table, api_analytics_summary, script_loadimpactdashboard, api_analytics_me, script_loadmyimpact [EXTRACTED 1.00]
- **Make-First Vehicle Setup Flow** — index_vehicle_setup_modal, script_openvehiclesetupmodal, script_handlesetupmakechange, script_populatemodeloptions, script_handlesetupmodelchange, script_handlesavevehicleprofile, api_user_vehicle, ev_models_dataset [EXTRACTED 1.00]
- **Persistence Layer (Supabase-first, file-backed fallback)** — api_handler_supabaserequest, lib_store_readstore, lib_store_writestore, api_handler_ensureseeded, supabase_users_table [EXTRACTED 1.00]

## Communities (15 total, 1 thin omitted)

### Community 0 - "Map, Route & Station Rendering"
Cohesion: 0.09
Nodes (53): activeRouteInfo, activeWaypoint (charger stopover), window.addChargerStopover(), adminOverrides, allStations, applyOverridesAndReports(), buildMergedStation(), calculateBestRecommendation() (+45 more)

### Community 1 - "Backend Route Handlers & Analytics Core"
Cohesion: 0.10
Nodes (48): POST /api/admin/charger/update, GET /api/admin/overrides, POST /api/admin/station/update, POST /api/analytics/event, GET /api/analytics/me, GET /api/analytics/summary, POST /api/auth/login, POST /api/auth/register (+40 more)

### Community 2 - "App Shell, Auth UI & Admin Console"
Cohesion: 0.07
Nodes (35): GET /api/config, GOOGLE_MAPS_API_KEY, Admin App Shell (#admin-app-shell), Admin System Analytics (#admin-panel-analytics), Admin Overview incl. Impact dashboard + trend chart (#admin-panel-dash), Admin Live Control Map (#admin-panel-map), Admin Manage Stations (#admin-panel-stations), Bottom Navigation (#bottom-navigation) (+27 more)

### Community 3 - "Password Hashing & Supabase Seed Script"
Cohesion: 0.15
Nodes (11): { hashPassword, verifyPassword }, crypto, hashPassword(), verifyPassword(), fs, { hashPassword }, https, path (+3 more)

### Community 4 - "NPM Package Manifest"
Cohesion: 0.13
Nodes (14): author, description, devDependencies, vercel, vercel, keywords, license, main (+6 more)

### Community 5 - "Make-First Vehicle Cascade & EV Profile"
Cohesion: 0.23
Nodes (13): GET /api/ev-makes, GET /api/ev-vehicles, evModels, ev_models.json - Indian-market EV catalogue, split into {make, model, modelFull, ...}, EV Profile Setup Modal - make-then-model cascade (#vehicle-setup-modal), applyUserVehicleToInputs(), cachedEvModels, checkUserVehicleProfile() (+5 more)

### Community 6 - "EPA/Atlas External APIs & Grid Stress"
Cohesion: 0.27
Nodes (12): GET /api/epa/makes, GET /api/epa/models, GET /api/epa/specs, US EPA fueleconomy.gov REST - vehicle spec lookup (unused by current UI), Graceful Degradation Pattern (Supabase -> file-backed store -> never a 5xx), GET /api/grid-demand, ATLAS_API_KEY (India Energy Atlas), extractMenuItems() (+4 more)

### Community 7 - "Auth Session & Login Flow"
Cohesion: 0.29
Nodes (5): Login Screen (#login-screen, User/Admin roles), activeUser (session identity), window.handleAuthLogin(), window.handleAuthLogout(), logAnalyticsEvent() - fire-and-forget POST to /api/analytics/event

### Community 8 - "Admin Station Edit & Overrides"
Cohesion: 0.33
Nodes (5): Admin Station Edit Modal (#admin-edit-station-modal), communityReports, window.overrideChargerStatus(), window.saveAdminStationEdit(), syncDatabaseState()

### Community 9 - "Home Tab Map Filters & Search"
Cohesion: 0.33
Nodes (3): Home / Map Tab (#panel-home), chargerTypeFilter / activeOnly / filter247Only, window.toggleFilterPill()

### Community 10 - "Trip Planner SOC/Range Inputs"
Cohesion: 0.47
Nodes (5): Trip Planner Tab (#panel-plan), window.updateBatterySOC(), window.updateEstRange(), window.updateReserveVal(), vehicleSOC / vehicleRange / minReserve

### Community 11 - "File-Backed Fallback Store"
Cohesion: 0.33
Nodes (5): defaultStore(), fs, os, path, STORE_PATH

### Community 13 - "Vercel Deployment Config"
Cohesion: 0.40
Nodes (4): maxDuration, functions, api/handler.js, rewrites

### Community 14 - "Open Charge Map Data Source"
Cohesion: 0.50
Nodes (4): OCM_API_KEY (Open Charge Map), GET /api/ocm-chargers, Open Charge Map API (api.openchargemap.io/v3/poi) - static charger POIs, fetchAllIndiaChargers()

## Knowledge Gaps
- **46 isolated node(s):** `https`, `fs`, `path`, `url`, `ANALYTICS_EVENT_TYPES` (+41 more)
  These have ≤1 connection - possible missing edges or undocumented components.
- **1 thin communities (<3 nodes) omitted from report** — run `graphify query` to explore isolated nodes.

## Suggested Questions
_Questions this graph is uniquely positioned to answer:_

- **Why does `index.html - single-page shell (login, user app, admin console)` connect `App Shell, Auth UI & Admin Console` to `Make-First Vehicle Cascade & EV Profile`, `Auth Session & Login Flow`, `Admin Station Edit & Overrides`, `Home Tab Map Filters & Search`, `Trip Planner SOC/Range Inputs`?**
  _High betweenness centrality (0.127) - this node is a cross-community bridge._
- **Why does `syncDatabaseState()` connect `Admin Station Edit & Overrides` to `Map, Route & Station Rendering`, `Backend Route Handlers & Analytics Core`?**
  _High betweenness centrality (0.062) - this node is a cross-community bridge._
- **Why does `GET /api/reports/summary` connect `Backend Route Handlers & Analytics Core` to `Admin Station Edit & Overrides`, `App Shell, Auth UI & Admin Console`?**
  _High betweenness centrality (0.057) - this node is a cross-community bridge._
- **Are the 13 inferred relationships involving `ensureSeeded()` (e.g. with `POST /api/admin/charger/update` and `GET /api/admin/overrides`) actually correct?**
  _`ensureSeeded()` has 13 INFERRED edges - model-reasoned connections that need verification._
- **What connects `https`, `fs`, `path` to the rest of the system?**
  _46 weakly-connected nodes found - possible documentation gaps or missing edges._
- **Should `Map, Route & Station Rendering` be split into smaller, more focused modules?**
  _Cohesion score 0.08649912331969609 - nodes in this community are weakly interconnected._
- **Should `Backend Route Handlers & Analytics Core` be split into smaller, more focused modules?**
  _Cohesion score 0.09503843466107617 - nodes in this community are weakly interconnected._