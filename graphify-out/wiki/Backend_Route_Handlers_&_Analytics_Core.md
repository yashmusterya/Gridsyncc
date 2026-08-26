# Backend Route Handlers & Analytics Core

> 54 nodes · cohesion 0.10

## Key Concepts

- **handler.js** (59 connections) — `api/handler.js`
- **readStore()** (18 connections) — `lib/store.js`
- **ensureSeeded()** (17 connections) — `api/handler.js`
- **supabaseRequest()** (14 connections) — `api/handler.js`
- **supabaseEnabled()** (12 connections) — `api/handler.js`
- **writeStore()** (12 connections) — `lib/store.js`
- **POST /api/auth/login** (9 connections) — `api/handler.js`
- **POST /api/auth/register** (9 connections) — `api/handler.js`
- **POST /api/user/vehicle** (9 connections) — `api/handler.js`
- **POST /api/admin/charger/update** (8 connections) — `api/handler.js`
- **POST /api/admin/station/update** (8 connections) — `api/handler.js`
- **GET /api/analytics/me** (8 connections) — `api/handler.js`
- **GET /api/analytics/summary** (8 connections) — `api/handler.js`
- **POST /api/reports/add** (8 connections) — `api/handler.js`
- **GET /api/reports/summary** (8 connections) — `api/handler.js`
- **POST /api/save-trip** (8 connections) — `api/handler.js`
- **GET /api/admin/overrides** (7 connections) — `api/handler.js`
- **POST /api/analytics/event** (7 connections) — `api/handler.js`
- **GET /api/get-saved-trips** (7 connections) — `api/handler.js`
- **Impact/Sustainability Analytics Pipeline (session_start / route_planned / charger_diverted -> kWh/CO2/revenue estimates)** (7 connections) — `script.js`
- **fetchAnalyticsEvents()** (6 connections) — `api/handler.js`
- **supabase/schema.sql - Postgres schema, run once in Supabase SQL Editor** (6 connections) — `supabase/schema.sql`
- **users table (email PK, password_hash, vehicle profile fields)** (6 connections) — `supabase/schema.sql`
- **summarizeAnalyticsEvents()** (4 connections) — `api/handler.js`
- **File-backed fallback store (os.tmpdir()) replacing global.inMemory*** (4 connections) — `lib/store.js`
- *... and 29 more nodes in this community*

## Relationships

- [Password Hashing & Supabase Seed Script](Password_Hashing_&_Supabase_Seed_Script.md) (9 shared connections)
- [EPA/Atlas External APIs & Grid Stress](EPA-Atlas_External_APIs_&_Grid_Stress.md) (9 shared connections)
- [App Shell, Auth UI & Admin Console](App_Shell,_Auth_UI_&_Admin_Console.md) (7 shared connections)
- [Admin Station Edit & Overrides](Admin_Station_Edit_&_Overrides.md) (4 shared connections)
- [Auth Session & Login Flow](Auth_Session_&_Login_Flow.md) (4 shared connections)
- [File-Backed Fallback Store](File-Backed_Fallback_Store.md) (4 shared connections)
- [Make-First Vehicle Cascade & EV Profile](Make-First_Vehicle_Cascade_&_EV_Profile.md) (4 shared connections)
- [Map, Route & Station Rendering](Map,_Route_&_Station_Rendering.md) (3 shared connections)
- [Open Charge Map Data Source](Open_Charge_Map_Data_Source.md) (2 shared connections)

## Source Files

- `api/handler.js`
- `lib/store.js`
- `package.json`
- `script.js`
- `supabase/schema.sql`
- `vahan_registry.json`

## Audit Trail

- EXTRACTED: 163 (90%)
- INFERRED: 19 (10%)
- AMBIGUOUS: 0 (0%)

---

*Part of the graphify knowledge wiki. See [index](index.md) to navigate.*