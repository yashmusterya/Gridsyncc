# Auth Session & Login Flow

> 7 nodes · cohesion 0.29

## Key Concepts

- **window.handleAuthLogin()** (5 connections) — `script.js`
- **logAnalyticsEvent() - fire-and-forget POST to /api/analytics/event** (5 connections) — `script.js`
- **Login Screen (#login-screen, User/Admin roles)** (4 connections) — `index.html`
- **activeUser (session identity)** (3 connections) — `script.js`
- **window.handleAuthLogout()** (2 connections) — `script.js`
- **window.showRegisterModal()** (1 connections) — `script.js`
- **window.switchLoginRole()** (1 connections) — `script.js`

## Relationships

- [Backend Route Handlers & Analytics Core](Backend_Route_Handlers_&_Analytics_Core.md) (4 shared connections)
- [App Shell, Auth UI & Admin Console](App_Shell,_Auth_UI_&_Admin_Console.md) (2 shared connections)
- [Map, Route & Station Rendering](Map,_Route_&_Station_Rendering.md) (2 shared connections)
- [Make-First Vehicle Cascade & EV Profile](Make-First_Vehicle_Cascade_&_EV_Profile.md) (1 shared connections)

## Source Files

- `index.html`
- `script.js`

## Audit Trail

- EXTRACTED: 15 (100%)
- INFERRED: 0 (0%)
- AMBIGUOUS: 0 (0%)

---

*Part of the graphify knowledge wiki. See [index](index.md) to navigate.*