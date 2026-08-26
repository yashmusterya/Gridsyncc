# App Shell, Auth UI & Admin Console

> 38 nodes · cohesion 0.07

## Key Concepts

- **index.html - single-page shell (login, user app, admin console)** (18 connections) — `index.html`
- **loadAdminDashboard()** (7 connections) — `script.js`
- **loadImpactDashboard()** (7 connections) — `script.js`
- **Profile Tab incl. Your GridSync Impact card (#panel-profile)** (5 connections) — `index.html`
- **loadMyImpact()** (5 connections) — `script.js`
- **renderPricingMetrics()** (5 connections) — `script.js`
- **renderAdminCharts()** (4 connections) — `script.js`
- **renderProfileDetails()** (4 connections) — `script.js`
- **GET /api/config** (3 connections) — `api/handler.js`
- **Admin App Shell (#admin-app-shell)** (3 connections) — `index.html`
- **Admin Overview incl. Impact dashboard + trend chart (#admin-panel-dash)** (3 connections) — `index.html`
- **Admin Manage Stations (#admin-panel-stations)** (3 connections) — `index.html`
- **Chart.js (CDN)** (3 connections) — `index.html`
- **Floating map controls (locate/zoom, #map-floating-overlay)** (3 connections) — `index.html`
- **window.centerMapOnUser()** (3 connections) — `script.js`
- **markerMap** (3 connections) — `script.js`
- **window.renderAdminStationsTable()** (3 connections) — `script.js`
- **renderImpactTrendChart()** (3 connections) — `script.js`
- **window.switchUserTab()** (3 connections) — `script.js`
- **Mobile responsive layer: safe-area insets, touch targets, admin horizontal-scroll nav, 16px input floor** (3 connections) — `style.css`
- **GOOGLE_MAPS_API_KEY** (2 connections) — `api/handler.js`
- **Admin System Analytics (#admin-panel-analytics)** (2 connections) — `index.html`
- **Admin Live Control Map (#admin-panel-map)** (2 connections) — `index.html`
- **Bottom Navigation (#bottom-navigation)** (2 connections) — `index.html`
- **Async Maps key loader: fetch('/api/config') then inject <script src>** (2 connections) — `index.html`
- *... and 13 more nodes in this community*

## Relationships

- [Map, Route & Station Rendering](Map,_Route_&_Station_Rendering.md) (13 shared connections)
- [Backend Route Handlers & Analytics Core](Backend_Route_Handlers_&_Analytics_Core.md) (7 shared connections)
- [Make-First Vehicle Cascade & EV Profile](Make-First_Vehicle_Cascade_&_EV_Profile.md) (3 shared connections)
- [Auth Session & Login Flow](Auth_Session_&_Login_Flow.md) (2 shared connections)
- [Home Tab Map Filters & Search](Home_Tab_Map_Filters_&_Search.md) (1 shared connections)
- [Trip Planner SOC/Range Inputs](Trip_Planner_SOC-Range_Inputs.md) (1 shared connections)
- [Admin Station Edit & Overrides](Admin_Station_Edit_&_Overrides.md) (1 shared connections)

## Source Files

- `api/handler.js`
- `index.html`
- `script.js`
- `style.css`

## Audit Trail

- EXTRACTED: 67 (89%)
- INFERRED: 8 (11%)
- AMBIGUOUS: 0 (0%)

---

*Part of the graphify knowledge wiki. See [index](index.md) to navigate.*