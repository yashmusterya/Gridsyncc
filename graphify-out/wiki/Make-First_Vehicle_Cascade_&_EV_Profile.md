# Make-First Vehicle Cascade & EV Profile

> 14 nodes · cohesion 0.23

## Key Concepts

- **EV Profile Setup Modal - make-then-model cascade (#vehicle-setup-modal)** (6 connections) — `index.html`
- **window.openVehicleSetupModal()** (6 connections) — `script.js`
- **populateModelOptions()** (5 connections) — `script.js`
- **GET /api/ev-makes** (4 connections) — `api/handler.js`
- **GET /api/ev-vehicles** (4 connections) — `api/handler.js`
- **ev_models.json - Indian-market EV catalogue, split into {make, model, modelFull, ...}** (4 connections) — `ev_models.json`
- **cachedEvModels** (4 connections) — `script.js`
- **checkUserVehicleProfile()** (4 connections) — `script.js`
- **Make-First Vehicle Cascade (car company -> model, ev_models.json split by make/model/modelFull)** (4 connections) — `script.js`
- **evModels** (3 connections) — `api/handler.js`
- **applyUserVehicleToInputs()** (3 connections) — `script.js`
- **window.handleSaveVehicleProfile()** (3 connections) — `script.js`
- **window.handleSetupMakeChange()** (3 connections) — `script.js`
- **window.handleSetupModelChange()** (1 connections) — `script.js`

## Relationships

- [Backend Route Handlers & Analytics Core](Backend_Route_Handlers_&_Analytics_Core.md) (4 shared connections)
- [Map, Route & Station Rendering](Map,_Route_&_Station_Rendering.md) (4 shared connections)
- [App Shell, Auth UI & Admin Console](App_Shell,_Auth_UI_&_Admin_Console.md) (3 shared connections)
- [Auth Session & Login Flow](Auth_Session_&_Login_Flow.md) (1 shared connections)

## Source Files

- `api/handler.js`
- `ev_models.json`
- `index.html`
- `script.js`

## Audit Trail

- EXTRACTED: 31 (94%)
- INFERRED: 2 (6%)
- AMBIGUOUS: 0 (0%)

---

*Part of the graphify knowledge wiki. See [index](index.md) to navigate.*