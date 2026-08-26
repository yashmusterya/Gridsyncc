# Open Charge Map Data Source

> 4 nodes · cohesion 0.50

## Key Concepts

- **GET /api/ocm-chargers** (4 connections) — `api/handler.js`
- **fetchAllIndiaChargers()** (4 connections) — `script.js`
- **OCM_API_KEY (Open Charge Map)** (2 connections) — `api/handler.js`
- **Open Charge Map API (api.openchargemap.io/v3/poi) - static charger POIs** (1 connections) — `api/handler.js`

## Relationships

- [Map, Route & Station Rendering](Map,_Route_&_Station_Rendering.md) (3 shared connections)
- [Backend Route Handlers & Analytics Core](Backend_Route_Handlers_&_Analytics_Core.md) (2 shared connections)

## Source Files

- `api/handler.js`
- `script.js`

## Audit Trail

- EXTRACTED: 8 (100%)
- INFERRED: 0 (0%)
- AMBIGUOUS: 0 (0%)

---

*Part of the graphify knowledge wiki. See [index](index.md) to navigate.*