# Trip Planner SOC/Range Inputs

> 6 nodes · cohesion 0.47

## Key Concepts

- **Trip Planner Tab (#panel-plan)** (6 connections) — `index.html`
- **vehicleSOC / vehicleRange / minReserve** (3 connections) — `script.js`
- **window.updateBatterySOC()** (2 connections) — `script.js`
- **window.updateEstRange()** (2 connections) — `script.js`
- **window.updateReserveVal()** (2 connections) — `script.js`
- **window.fillGPSLocation()** (1 connections) — `script.js`

## Relationships

- [App Shell, Auth UI & Admin Console](App_Shell,_Auth_UI_&_Admin_Console.md) (1 shared connections)
- [Map, Route & Station Rendering](Map,_Route_&_Station_Rendering.md) (1 shared connections)

## Source Files

- `index.html`
- `script.js`

## Audit Trail

- EXTRACTED: 9 (100%)
- INFERRED: 0 (0%)
- AMBIGUOUS: 0 (0%)

---

*Part of the graphify knowledge wiki. See [index](index.md) to navigate.*