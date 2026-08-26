# readStore()

> God node · 18 connections · `lib/store.js`

**Community:** [Backend Route Handlers & Analytics Core](Backend_Route_Handlers_&_Analytics_Core.md)

## Connections by Relation

### calls
- POST /api/auth/login `EXTRACTED`
- POST /api/auth/register `EXTRACTED`
- POST /api/user/vehicle `EXTRACTED`
- POST /api/admin/charger/update `EXTRACTED`
- POST /api/admin/station/update `EXTRACTED`
- GET /api/analytics/me `EXTRACTED`
- GET /api/analytics/summary `EXTRACTED`
- POST /api/reports/add `EXTRACTED`
- GET /api/reports/summary `EXTRACTED`
- POST /api/save-trip `EXTRACTED`
- GET /api/admin/overrides `EXTRACTED`
- POST /api/analytics/event `EXTRACTED`
- GET /api/get-saved-trips `EXTRACTED`
- defaultStore() `EXTRACTED`

### imports
- handler.js `EXTRACTED`

### indirect_call
- store.js `INFERRED`

### rationale_for
- File-backed fallback store (os.tmpdir()) replacing global.inMemory* `EXTRACTED`

### references
- { readStore, writeStore } `EXTRACTED`

---

*Part of the graphify knowledge wiki. See [index](index.md) to navigate.*