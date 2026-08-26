# EPA/Atlas External APIs & Grid Stress

> 12 nodes · cohesion 0.27

## Key Concepts

- **GET /api/grid-demand** (6 connections) — `api/handler.js`
- **GET /api/epa/makes** (5 connections) — `api/handler.js`
- **GET /api/epa/models** (5 connections) — `api/handler.js`
- **GET /api/epa/specs** (5 connections) — `api/handler.js`
- **fetchEpaData()** (5 connections) — `api/handler.js`
- **LOCAL_EPA_FALLBACK** (5 connections) — `api/handler.js`
- **US EPA fueleconomy.gov REST - vehicle spec lookup (unused by current UI)** (4 connections) — `api/handler.js`
- **extractMenuItems()** (4 connections) — `api/handler.js`
- **Graceful Degradation Pattern (Supabase -> file-backed store -> never a 5xx)** (3 connections) — `api/handler.js`
- **ATLAS_API_KEY (India Energy Atlas)** (2 connections) — `api/handler.js`
- **Grid Stress Index (0-1 from demand MW + frequency Hz)** (2 connections) — `script.js`
- **India Energy Atlas API (api.energymap.in) - national grid demand/frequency** (1 connections) — `api/handler.js`

## Relationships

- [Backend Route Handlers & Analytics Core](Backend_Route_Handlers_&_Analytics_Core.md) (9 shared connections)
- [Map, Route & Station Rendering](Map,_Route_&_Station_Rendering.md) (2 shared connections)

## Source Files

- `api/handler.js`
- `script.js`

## Audit Trail

- EXTRACTED: 26 (90%)
- INFERRED: 3 (10%)
- AMBIGUOUS: 0 (0%)

---

*Part of the graphify knowledge wiki. See [index](index.md) to navigate.*