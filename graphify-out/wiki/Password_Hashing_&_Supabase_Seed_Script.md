# Password Hashing & Supabase Seed Script

> 15 nodes · cohesion 0.15

## Key Concepts

- **seed-supabase.js** (10 connections) — `scripts/seed-supabase.js`
- **hashPassword()** (8 connections) — `lib/auth.js`
- **auth.js** (5 connections) — `lib/auth.js`
- **verifyPassword()** (4 connections) — `lib/auth.js`
- **{ hashPassword, verifyPassword }** (3 connections) — `api/handler.js`
- **scripts/seed-supabase.js - one-time demo account seeder for the real users table** (2 connections) — `scripts/seed-supabase.js`
- **crypto** (1 connections) — `lib/auth.js`
- **fs** (1 connections) — `scripts/seed-supabase.js`
- **{ hashPassword }** (1 connections) — `scripts/seed-supabase.js`
- **https** (1 connections) — `scripts/seed-supabase.js`
- **loadDotEnvLocal()** (1 connections) — `scripts/seed-supabase.js`
- **path** (1 connections) — `scripts/seed-supabase.js`
- **seedUsers** (1 connections) — `scripts/seed-supabase.js`
- **upsertUsers()** (1 connections) — `scripts/seed-supabase.js`
- **url** (1 connections) — `scripts/seed-supabase.js`

## Relationships

- [Backend Route Handlers & Analytics Core](Backend_Route_Handlers_&_Analytics_Core.md) (9 shared connections)

## Source Files

- `api/handler.js`
- `lib/auth.js`
- `scripts/seed-supabase.js`

## Audit Trail

- EXTRACTED: 23 (92%)
- INFERRED: 2 (8%)
- AMBIGUOUS: 0 (0%)

---

*Part of the graphify knowledge wiki. See [index](index.md) to navigate.*