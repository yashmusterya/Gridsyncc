# Graph Report - GridSync-ll  (2026-08-26)

## Corpus Check
- Corpus is ~19,493 words - fits in a single context window. You may not need a graph.

## Summary
- 199 nodes · 419 edges · 8 communities
- Extraction: 92% EXTRACTED · 8% INFERRED · 0% AMBIGUOUS · INFERRED: 34 edges (avg confidence: 0.91)
- Token cost: 0 input · 0 output

## Community Hubs (Navigation)
- Map, Route & Station Rendering
- Node Proxy & Fallback Backend
- Auth, App Shells & Admin Console
- MLP Recommendation & Grid Pricing
- EV Profile & Range Model
- Admin Overrides & Community Reports
- Charger Data Sources & Map Filters
- NPM Package Manifest

## God Nodes (most connected - your core abstractions)
1. `planTrip()` - 22 edges
2. `server` - 21 edges
3. `index.html - single-page shell (login, user app, admin console)` - 21 edges
4. `initMap()` - 19 edges
5. `plotMarkers()` - 15 edges
6. `mergeLiveGooglePlaces()` - 13 edges
7. `createInfoWindowContent()` - 12 edges
8. `calculateBestRecommendation()` - 10 edges
9. `updateRecommendationDashboard()` - 10 edges
10. `loadInitialData()` - 9 edges

## Surprising Connections (you probably didn't know these)
- `toggleSimulationDrive() - onclick target with NO definition (broken wiring)` --semantically_similar_to--> `toggleSimulator()`  [AMBIGUOUS] [semantically similar]
  index.html → script.js
- `Hardcoded Google Maps API key in <script src> query string` --semantically_similar_to--> `OCM_API_KEY (Open Charge Map)`  [INFERRED] [semantically similar]
  index.html → server.js
- `plotMarkers()` --references--> `Google Map Canvas (#map-container, floating controls)`  [INFERRED]
  script.js → index.html
- `initMap()` --references--> `Google Map Canvas (#map-container, floating controls)`  [INFERRED]
  script.js → index.html
- `renderProfileDetails()` --references--> `Profile Tab (#panel-profile, saved stations, history)`  [INFERRED]
  script.js → index.html

## Import Cycles
- None detected.

## Hyperedges (group relationships)
- **Authentication & Session Flow** — index_login_screen, script_handleauthlogin, server_api_auth_login, server_inmemoryusers, script_activeuser, script_checkuservehicleprofile, script_handleauthregister, server_api_auth_register [EXTRACTED 1.00]
- **Station Data Fusion Pipeline** — script_fetchallindiachargers, server_api_ocm_chargers, script_buildmergedstation, script_fetchgoogleplacesforviewport, script_google_places_api, script_mergelivegoogleplaces, script_applyoverridesandreports, script_allstations, script_plotmarkers, script_station_fusion_model [EXTRACTED 1.00]
- **Grid-Aware Recommendation Engine** — server_api_grid_demand, script_fetchindiaenergyatlasgriddata, script_getgridstressindex, script_stationrecommendationmlp, script_evaluatestationwithml, script_calculatebestrecommendation, script_getstationgridloadandprice, script_updaterecommendationdashboard, server_api_predict_arrival [EXTRACTED 1.00]

## Communities (8 total, 0 thin omitted)

### Community 0 - "Map, Route & Station Rendering"
Cohesion: 0.10
Nodes (46): toggleSimulationDrive() - onclick target with NO definition (broken wiring), Trip Planner Tab (#panel-plan, SOC/range/reserve inputs), activeRouteInfo, activeWaypoint (charger stopover), window.addChargerStopover(), allStations, buildMergedStation(), clearDirectionsRoute() (+38 more)

### Community 1 - "Node Proxy & Fallback Backend"
Cohesion: 0.09
Nodes (34): applyUserVehicleToInputs(), window.handleAuthRegister(), window.handleSaveVehicleProfile(), POST /api/auth/register, GET /api/epa/makes, GET /api/epa/models, GET /api/epa/specs, GET /api/get-saved-trips (+26 more)

### Community 2 - "Auth, App Shells & Admin Console"
Cohesion: 0.09
Nodes (27): Admin Station Edit Modal (#admin-edit-station-modal), Admin System Analytics (#admin-panel-analytics), Admin Overview (#admin-panel-dash, fleet stats + grid telemetry), Admin Live Control Map (#admin-panel-map), Admin Manage Stations (#admin-panel-stations), Bottom Navigation (#bottom-navigation), Chart.js (CDN) - pricing + admin analytics charts, index.html - single-page shell (login, user app, admin console) (+19 more)

### Community 3 - "MLP Recommendation & Grid Pricing"
Cohesion: 0.14
Nodes (18): Google Map Canvas (#map-container, floating controls), calculateBestRecommendation(), createInfoWindowContent(), Dynamic Pricing Model (base AC 5.5 / DC 11.5 x grid multiplier), evaluateStationWithML(), fetchLiveGridTelemetry(), getDistanceMeters(), getGridStressIndex() (+10 more)

### Community 4 - "EV Profile & Range Model"
Cohesion: 0.13
Nodes (16): ev_models.json - Indian-market EV spec catalogue, Admin App Shell (#admin-app-shell), Profile Tab (#panel-profile, saved stations, history), EV Profile Setup Modal (#vehicle-setup-modal), cachedEvModels, window.handleAuthLogout(), window.handleSetupModelChange(), window.openVehicleSetupModal() (+8 more)

### Community 5 - "Admin Overrides & Community Reports"
Cohesion: 0.22
Nodes (16): adminOverrides, applyOverridesAndReports(), Community Trust Loop (driver reports -> station status -> ML availability input), communityReports, window.overrideChargerStatus(), window.saveAdminStationEdit(), window.submitChargerReport(), syncDatabaseState() (+8 more)

### Community 6 - "Charger Data Sources & Map Filters"
Cohesion: 0.14
Nodes (12): Hardcoded Google Maps API key in <script src> query string, Home / Map Tab (#panel-home, bottom sheet, filter pills), chargerTypeFilter / activeOnly / filter247Only, fetchGooglePlacesForViewport(), getGoogleMapsApiKey(), Google Maps JavaScript API (maps, places, geometry, DirectionsService), Google Places API v1 (places:searchText) - live EV connector availability, window.syncSearchDestination() (+4 more)

### Community 7 - "NPM Package Manifest"
Cohesion: 0.17
Nodes (11): author, description, keywords, license, main, name, scripts, start (+3 more)

## Ambiguous Edges - Review These
- `toggleSimulator()` → `toggleSimulationDrive() - onclick target with NO definition (broken wiring)`  [AMBIGUOUS]
  index.html · relation: semantically_similar_to

## Knowledge Gaps
- **29 isolated node(s):** `name`, `version`, `description`, `main`, `test` (+24 more)
  These have ≤1 connection - possible missing edges or undocumented components.

## Suggested Questions
_Questions this graph is uniquely positioned to answer:_

- **What is the exact relationship between `toggleSimulator()` and `toggleSimulationDrive() - onclick target with NO definition (broken wiring)`?**
  _Edge tagged AMBIGUOUS (relation: semantically_similar_to) - confidence is low._
- **Why does `server` connect `Node Proxy & Fallback Backend` to `Auth, App Shells & Admin Console`, `MLP Recommendation & Grid Pricing`, `EV Profile & Range Model`, `Admin Overrides & Community Reports`, `Charger Data Sources & Map Filters`?**
  _High betweenness centrality (0.223) - this node is a cross-community bridge._
- **Why does `index.html - single-page shell (login, user app, admin console)` connect `Auth, App Shells & Admin Console` to `Map, Route & Station Rendering`, `Node Proxy & Fallback Backend`, `MLP Recommendation & Grid Pricing`, `EV Profile & Range Model`, `Charger Data Sources & Map Filters`?**
  _High betweenness centrality (0.197) - this node is a cross-community bridge._
- **Why does `planTrip()` connect `Map, Route & Station Rendering` to `MLP Recommendation & Grid Pricing`, `Charger Data Sources & Map Filters`?**
  _High betweenness centrality (0.078) - this node is a cross-community bridge._
- **Are the 2 inferred relationships involving `initMap()` (e.g. with `Google Map Canvas (#map-container, floating controls)` and `hideStatus()`) actually correct?**
  _`initMap()` has 2 INFERRED edges - model-reasoned connections that need verification._
- **What connects `name`, `version`, `description` to the rest of the system?**
  _29 weakly-connected nodes found - possible documentation gaps or missing edges._
- **Should `Map, Route & Station Rendering` be split into smaller, more focused modules?**
  _Cohesion score 0.0977891156462585 - nodes in this community are weakly interconnected._