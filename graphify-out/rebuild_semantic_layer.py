import json
from pathlib import Path

ROOT = "C:\\Users\\HP\\Downloads\\GridSync-ll"
F_HANDLER = ROOT + "\\api\\handler.js"
F_SCRIPT = ROOT + "\\script.js"
F_INDEX = ROOT + "\\index.html"
F_STYLE = ROOT + "\\style.css"
F_EV = ROOT + "\\ev_models.json"
F_VAHAN = ROOT + "\\vahan_registry.json"
F_STORE = ROOT + "\\lib\\store.js"
F_AUTH = ROOT + "\\lib\\auth.js"
F_SCHEMA = ROOT + "\\supabase\\schema.sql"
F_SEED = ROOT + "\\scripts\\seed-supabase.js"
F_PKG = ROOT + "\\package.json"

nodes = []
edges = []
hyperedges = []


def N(nid, label, ftype, src, loc=None, rationale=None):
    n = {
        "id": nid, "label": label, "file_type": ftype, "source_file": src,
        "source_location": loc, "source_url": None, "captured_at": None,
        "author": None, "contributor": None,
    }
    if rationale:
        n["rationale"] = rationale
    nodes.append(n)


def E(s, t, rel, conf, score, src, loc=None, w=1.0):
    edges.append({
        "source": s, "target": t, "relation": rel, "confidence": conf,
        "confidence_score": score, "source_file": src, "source_location": loc, "weight": w,
    })


# ============================================================ api/handler.js
ENDPOINTS = [
    ("api_config", "GET /api/config", "api/handler.js:381", None, None),
    ("api_grid_demand", "GET /api/grid-demand", "api/handler.js:389", None, "api_india_energy_atlas_api"),
    ("api_ocm_chargers", "GET /api/ocm-chargers", "api/handler.js:451", None, "api_open_charge_map_api"),
    ("api_save_trip", "POST /api/save-trip", "api/handler.js:511", "supabase_saved_trips_table", "api_supabase_rest_api"),
    ("api_get_saved_trips", "GET /api/get-saved-trips", "api/handler.js:543", "supabase_saved_trips_table", "api_supabase_rest_api"),
    ("api_auth_login", "POST /api/auth/login", "api/handler.js:560", "supabase_users_table", None),
    ("api_auth_register", "POST /api/auth/register", "api/handler.js:589", "supabase_users_table", None),
    ("api_epa_makes", "GET /api/epa/makes", "api/handler.js:638", "api_handler_local_epa_fallback", "api_fueleconomy_gov_api"),
    ("api_epa_models", "GET /api/epa/models", "api/handler.js:663", "api_handler_local_epa_fallback", "api_fueleconomy_gov_api"),
    ("api_epa_specs", "GET /api/epa/specs", "api/handler.js:688", "api_handler_local_epa_fallback", "api_fueleconomy_gov_api"),
    ("api_ev_makes", "GET /api/ev-makes", "api/handler.js:757", "api_handler_evmodels", None),
    ("api_ev_vehicles", "GET /api/ev-vehicles", "api/handler.js:765", "api_handler_evmodels", None),
    ("api_vahan_vehicle", "GET /api/vahan/vehicle", "api/handler.js:772", "api_handler_vahanregistry", None),
    ("api_user_vehicle", "POST /api/user/vehicle", "api/handler.js:800", "supabase_users_table", None),
    ("api_reports_add", "POST /api/reports/add", "api/handler.js:847", "supabase_reports_table", None),
    ("api_reports_summary", "GET /api/reports/summary", "api/handler.js:879", "supabase_reports_table", None),
    ("api_admin_station_update", "POST /api/admin/station/update", "api/handler.js:906", "supabase_station_overrides_table", None),
    ("api_admin_charger_update", "POST /api/admin/charger/update", "api/handler.js:950", "supabase_charger_overrides_table", None),
    ("api_admin_overrides", "GET /api/admin/overrides", "api/handler.js:980", "supabase_station_overrides_table", None),
    ("api_analytics_event", "POST /api/analytics/event", "api/handler.js:1014", None, None),
    ("api_analytics_summary", "GET /api/analytics/summary", "api/handler.js:1046", None, None),
    ("api_analytics_me", "GET /api/analytics/me", "api/handler.js:1077", None, None),
    ("api_predict_arrival", "POST /api/predict_arrival", "api/handler.js:1098", None, None),
]

for suffix, label, loc, store_node, ext in ENDPOINTS:
    nid = "api_" + suffix if not suffix.startswith("api_") else suffix
    nid = suffix if suffix.startswith("api_") else "api_" + suffix
    N(nid, label, "code", F_HANDLER, loc)
    E("api_handler", nid, "calls", "EXTRACTED", 1.0, F_HANDLER, loc)
    if store_node:
        E(nid, store_node, "shares_data_with", "EXTRACTED", 1.0, F_HANDLER, loc)
    if ext:
        E(nid, ext, "references", "EXTRACTED", 1.0, F_HANDLER, loc)

N("api_static_file_handler", "Static File Server (fallback route, index.html/script.js/style.css)", "code", F_HANDLER, "api/handler.js:838")
E("api_handler", "api_static_file_handler", "calls", "EXTRACTED", 1.0, F_HANDLER)

# lib/auth.js and lib/store.js wiring
E("api_handler_hashpassword_verifypassword", "lib_auth_hashpassword", "references", "EXTRACTED", 1.0, F_HANDLER, "api/handler.js:5")
E("api_handler_hashpassword_verifypassword", "lib_auth_verifypassword", "references", "EXTRACTED", 1.0, F_HANDLER, "api/handler.js:5")
E("api_handler_readstore_writestore", "lib_store_readstore", "references", "EXTRACTED", 1.0, F_HANDLER, "api/handler.js:6")
E("api_handler_readstore_writestore", "lib_store_writestore", "references", "EXTRACTED", 1.0, F_HANDLER, "api/handler.js:6")
for ep in ("api_auth_login", "api_auth_register", "api_user_vehicle"):
    E(ep, "lib_auth_hashpassword" if ep != "api_auth_login" else "lib_auth_verifypassword", "calls", "EXTRACTED", 1.0, F_HANDLER)
E("api_handler_ensureseeded", "lib_auth_hashpassword", "calls", "EXTRACTED", 1.0, F_HANDLER, "api/handler.js:222")
for ep in ("api_save_trip", "api_get_saved_trips", "api_auth_login", "api_auth_register",
           "api_user_vehicle", "api_reports_add", "api_reports_summary",
           "api_admin_station_update", "api_admin_charger_update", "api_admin_overrides",
           "api_analytics_event", "api_analytics_summary", "api_analytics_me"):
    E(ep, "api_handler_ensureseeded", "conceptually_related_to", "INFERRED", 0.9, F_HANDLER)
    E(ep, "lib_store_readstore", "calls", "EXTRACTED", 1.0, F_HANDLER)
for ep in ("api_save_trip", "api_auth_register", "api_user_vehicle", "api_reports_add",
           "api_admin_station_update", "api_admin_charger_update", "api_analytics_event"):
    E(ep, "lib_store_writestore", "calls", "EXTRACTED", 1.0, F_HANDLER)

E("api_analytics_summary", "api_handler_fetchanalyticsevents", "calls", "EXTRACTED", 1.0, F_HANDLER)
E("api_analytics_me", "api_handler_fetchanalyticsevents", "calls", "EXTRACTED", 1.0, F_HANDLER)
E("api_handler_fetchanalyticsevents", "api_handler_summarizeanalyticsevents", "conceptually_related_to", "INFERRED", 0.9, F_HANDLER)
E("api_analytics_summary", "api_handler_summarizeanalyticsevents", "calls", "EXTRACTED", 1.0, F_HANDLER)
E("api_analytics_me", "api_handler_summarizeanalyticsevents", "calls", "EXTRACTED", 1.0, F_HANDLER)
E("api_handler_fetchanalyticsevents", "api_handler_supabaserequest", "calls", "EXTRACTED", 1.0, F_HANDLER)
for ep in ("api_save_trip", "api_get_saved_trips", "api_auth_login", "api_auth_register",
           "api_user_vehicle", "api_reports_add", "api_reports_summary",
           "api_admin_station_update", "api_admin_charger_update", "api_admin_overrides"):
    E(ep, "api_handler_supabaserequest", "calls", "EXTRACTED", 1.0, F_HANDLER)
    E(ep, "api_handler_supabaseenabled", "calls", "EXTRACTED", 1.0, F_HANDLER)
for ep in ("api_epa_makes", "api_epa_models", "api_epa_specs"):
    E(ep, "api_handler_fetchepadata", "calls", "EXTRACTED", 1.0, F_HANDLER)
    E(ep, "api_handler_extractmenuitems", "calls", "EXTRACTED", 1.0, F_HANDLER)
E("api_handler_fetchepadata", "api_fueleconomy_gov_api", "references", "EXTRACTED", 1.0, F_HANDLER, "api/handler.js:670")

CONFIG = [
    ("api_handler_atlas_api_key", "ATLAS_API_KEY (India Energy Atlas)", "api/handler.js:9"),
    ("api_handler_ocm_api_key", "OCM_API_KEY (Open Charge Map)", "api/handler.js:10"),
    ("api_handler_supabase_url", "SUPABASE_URL", "api/handler.js:11"),
    ("api_handler_supabase_key", "SUPABASE_KEY", "api/handler.js:12"),
    ("api_handler_google_maps_api_key", "GOOGLE_MAPS_API_KEY", "api/handler.js:13"),
]
for nid, label, loc in CONFIG:
    N(nid, label, "code", F_HANDLER, loc)
    E(nid, "api_handler", "shares_data_with", "EXTRACTED", 1.0, F_HANDLER, loc)
E("api_grid_demand", "api_handler_atlas_api_key", "references", "EXTRACTED", 1.0, F_HANDLER)
E("api_ocm_chargers", "api_handler_ocm_api_key", "references", "EXTRACTED", 1.0, F_HANDLER)
E("api_handler_supabaserequest", "api_handler_supabase_url", "references", "EXTRACTED", 1.0, F_HANDLER)
E("api_handler_supabaserequest", "api_handler_supabase_key", "references", "EXTRACTED", 1.0, F_HANDLER)
E("api_config", "api_handler_google_maps_api_key", "references", "EXTRACTED", 1.0, F_HANDLER)

EXTERNALS = [
    ("api_india_energy_atlas_api", "India Energy Atlas API (api.energymap.in) - national grid demand/frequency", F_HANDLER, "api/handler.js:405"),
    ("api_open_charge_map_api", "Open Charge Map API (api.openchargemap.io/v3/poi) - static charger POIs", F_HANDLER, "api/handler.js:459"),
    ("api_supabase_rest_api", "Supabase PostgREST API (/rest/v1) - primary persistence", F_HANDLER, "api/handler.js:24"),
    ("api_fueleconomy_gov_api", "US EPA fueleconomy.gov REST - vehicle spec lookup (unused by current UI)", F_HANDLER, "api/handler.js:670"),
]
for nid, label, src, loc in EXTERNALS:
    N(nid, label, "concept", src, loc)

N("ev_models_dataset", "ev_models.json - Indian-market EV catalogue, split into {make, model, modelFull, ...}", "document", F_EV)
N("vahan_registry_dataset", "vahan_registry.json - simulated VAHAN national EV registration registry", "document", F_VAHAN)
E("api_ev_vehicles", "ev_models_dataset", "references", "EXTRACTED", 1.0, F_HANDLER, "api/handler.js:759")
E("api_ev_makes", "ev_models_dataset", "references", "EXTRACTED", 1.0, F_HANDLER, "api/handler.js:757")
E("api_vahan_vehicle", "vahan_registry_dataset", "references", "EXTRACTED", 1.0, F_HANDLER, "api/handler.js:772")

# ============================================================ lib/store.js
N("lib_store_persistence_fix", "File-backed fallback store (os.tmpdir()) replacing global.inMemory*", "rationale", F_STORE, "lib/store.js:1")
nodes[-1]["rationale"] = ("global.* did NOT survive between requests under `vercel dev` local emulation - every "
                          "write (reports, admin overrides, saved trips, analytics events) silently succeeded but "
                          "the very next read came back empty, confirmed by testing POST /api/reports/add followed "
                          "immediately by GET /api/reports/summary. Root cause: vercel dev's per-invocation isolate "
                          "model does not share process globals the way a persistent Node process does. Fix: read/write "
                          "a JSON file in os.tmpdir() at the top of every request instead of relying on `global`. "
                          "Does not fix true serverless production without Supabase (/tmp is still wiped on cold start "
                          "there) - only makes local dev and any non-ephemeral host actually work.")
E("lib_store_persistence_fix", "lib_store_readstore", "rationale_for", "EXTRACTED", 1.0, F_STORE)
E("lib_store_persistence_fix", "lib_store_writestore", "rationale_for", "EXTRACTED", 1.0, F_STORE)
E("lib_store_persistence_fix", "api_handler_ensureseeded", "rationale_for", "EXTRACTED", 1.0, F_HANDLER)

# ============================================================ supabase/schema.sql (tree_sitter_sql not installed - hand-authored)
N("schema_sql", "supabase/schema.sql - Postgres schema, run once in Supabase SQL Editor", "document", F_SCHEMA)
TABLES = [
    ("supabase_users_table", "users table (email PK, password_hash, vehicle profile fields)", "supabase/schema.sql:11"),
    ("supabase_saved_trips_table", "saved_trips table (id PK, jsonb data)", "supabase/schema.sql:29"),
    ("supabase_reports_table", "reports table (station_id, working bool, user_email)", "supabase/schema.sql:34"),
    ("supabase_station_overrides_table", "station_overrides table (station_id PK)", "supabase/schema.sql:42"),
    ("supabase_charger_overrides_table", "charger_overrides table (station_id+charger_id PK)", "supabase/schema.sql:52"),
    ("supabase_analytics_events_table", "analytics_events table (event_type, user_email, station_id, jsonb metadata)", "supabase/schema.sql:66"),
]
for nid, label, loc in TABLES:
    N(nid, label, "code", F_SCHEMA, loc)
    E("schema_sql", nid, "references", "EXTRACTED", 1.0, F_SCHEMA, loc)
E("api_analytics_event", "supabase_analytics_events_table", "shares_data_with", "EXTRACTED", 1.0, F_HANDLER, "api/handler.js:1029")
E("api_analytics_summary", "supabase_analytics_events_table", "shares_data_with", "EXTRACTED", 1.0, F_HANDLER)
E("api_analytics_me", "supabase_analytics_events_table", "shares_data_with", "EXTRACTED", 1.0, F_HANDLER)

N("seed_supabase_script", "scripts/seed-supabase.js - one-time demo account seeder for the real users table", "code", F_SEED)
E("seed_supabase_script", "supabase_users_table", "shares_data_with", "EXTRACTED", 1.0, F_SEED)
E("seed_supabase_script", "lib_auth_hashpassword", "calls", "EXTRACTED", 1.0, F_SEED)

# ============================================================ package.json / vercel.json
N("pkg_dev_script_fix", "Removed package.json \"dev\": \"vercel dev\" script", "rationale", F_PKG)
nodes[-1]["rationale"] = ("Vercel CLI refuses to run with the error \"vercel dev must not recursively invoke itself\" "
                          "whenever package.json's own dev script is literally \"vercel dev\", regardless of how it's "
                          "invoked (confirmed: `npx vercel dev` fails identically to `npm run dev`). This blocked all "
                          "local development and testing outright. The standard, correct convention for a Vercel-linked "
                          "project is to run `vercel dev` directly from the terminal, not via an npm script wrapping it.")
E("pkg_dev_script_fix", "api_handler", "rationale_for", "EXTRACTED", 1.0, F_PKG)

# ============================================================ script.js window handlers
WINDOW_FNS = [
    ("submitchargerreport", "window.submitChargerReport()", "script.js:601"),
    ("togglebookmarkstation", "window.toggleBookmarkStation()", "script.js:660"),
    ("togglestationdetails", "window.toggleStationDetails()", "script.js:807"),
    ("selectstationasdestination", "window.selectStationAsDestination()", "script.js:820"),
    ("focusstationonmap", "window.focusStationOnMap()", "script.js:852"),
    ("syncsearchdestination", "window.syncSearchDestination()", "script.js:1802"),
    ("togglebottomsheetheight", "window.toggleBottomSheetHeight()", "script.js:1941"),
    ("togglemaplegend", "window.toggleMapLegend()", "script.js:1949"),
    ("togglefilterpill", "window.toggleFilterPill()", "script.js:1957"),
    ("centermaponuser", "window.centerMapOnUser()", "script.js:1989"),
    ("zoommap", "window.zoomMap()", "script.js:2010"),
    ("fillgpslocation", "window.fillGPSLocation()", "script.js:2019"),
    ("updatebatterysoc", "window.updateBatterySOC()", "script.js:2030"),
    ("updateestrange", "window.updateEstRange()", "script.js:2047"),
    ("updatereserveval", "window.updateReserveVal()", "script.js:2061"),
    ("switchusertab", "window.switchUserTab()", "script.js:2074"),
    ("switchadmintab", "window.switchAdminTab()", "script.js:2118"),
    ("handleauthlogin", "window.handleAuthLogin()", "script.js:2264"),
    ("handleauthregister", "window.handleAuthRegister()", "script.js:2330"),
    ("handleauthlogout", "window.handleAuthLogout()", "script.js:2361"),
    ("switchloginrole", "window.switchLoginRole()", "script.js:2379"),
    ("showregistermodal", "window.showRegisterModal()", "script.js:2390"),
    ("hideregistermodal", "window.hideRegisterModal()", "script.js:2394"),
    ("addchargerstopover", "window.addChargerStopover()", "script.js:2534"),
    ("removechargerstopover", "window.removeChargerStopover()", "script.js:2547"),
    ("filteradminmappins", "window.filterAdminMapPins()", "script.js:3197"),
    ("renderadminstationstable", "window.renderAdminStationsTable()", "script.js:3221"),
    ("openadmineditmodal", "window.openAdminEditModal()", "script.js:3376"),
    ("closeadmineditmodal", "window.closeAdminEditModal()", "script.js:3415"),
    ("overridechargerstatus", "window.overrideChargerStatus()", "script.js:3422"),
    ("saveadminstationedit", "window.saveAdminStationEdit()", "script.js:3459"),
    ("openvehiclesetupmodal", "window.openVehicleSetupModal()", "script.js:3555"),
    ("handlesetupmakechange", "window.handleSetupMakeChange()", "script.js:3603"),
    ("handlesetupmodelchange", "window.handleSetupModelChange()", "script.js:3616"),
    ("handlesavevehicleprofile", "window.handleSaveVehicleProfile()", "script.js:3642"),
    ("triggergoogleauthlogin", "window.triggerGoogleAuthLogin()", "script.js:3698"),
    ("togglesimulator", "toggleSimulator() (top-level, window-visible via classic script)", "script.js:3037"),
]
for suffix, label, loc in WINDOW_FNS:
    N("script_" + suffix, label, "code", F_SCRIPT, loc)

STATE = [
    ("script_map", "map (google.maps.Map instance)", "script.js:4"),
    ("script_userlocation", "userLocation", "script.js:10"),
    ("script_activeuser", "activeUser (session identity)", "script.js:35"),
    ("script_recommendedstation", "recommendedStation", "script.js:27"),
    ("script_livegriddemand", "liveGridDemand (Atlas telemetry cache)", "script.js:29"),
    ("script_vehiclesoc", "vehicleSOC / vehicleRange / minReserve", "script.js:30"),
    ("script_activerouteinfo", "activeRouteInfo", "script.js:28"),
    ("script_activewaypoint", "activeWaypoint (charger stopover)", "script.js:36"),
    ("script_chargertypefilter", "chargerTypeFilter / activeOnly / filter247Only", "script.js:22"),
    ("script_directionsservice", "directionsService / directionsRenderer", "script.js:18"),
    ("script_lastdirectionsresponse", "lastDirectionsResponse (fixed: was an implicit global)", "script.js:29"),
    ("script_cachedevmodels", "cachedEvModels (full make+model list, cached once)", "script.js:3555"),
    ("script_adminimpacttrendchart", "adminImpactTrendChart (Chart.js instance)", "script.js:41"),
]
for nid, label, loc in STATE:
    N(nid, label, "code", F_SCRIPT, loc)

CLIENT_CALLS = [
    ("script_syncdatabasestate", "api_admin_overrides", "script.js:268"),
    ("script_syncdatabasestate", "api_reports_summary", "script.js:275"),
    ("script_submitchargerreport", "api_reports_add", "script.js:609"),
    ("script_fetchindiaenergyatlasgriddata", "api_grid_demand", "script.js:1000"),
    ("script_fetchallindiachargers", "api_ocm_chargers", "script.js:1280"),
    ("script_startgeolocationtracking", "api_predict_arrival", "script.js:1700"),
    ("script_handleauthlogin", "api_auth_login", "script.js:2271"),
    ("script_handleauthregister", "api_auth_register", "script.js:2337"),
    ("script_loadadmindashboard", "api_reports_summary", "script.js:3172"),
    ("script_overridechargerstatus", "api_admin_charger_update", "script.js:3427"),
    ("script_saveadminstationedit", "api_admin_station_update", "script.js:3472"),
    ("script_openvehiclesetupmodal", "api_ev_vehicles", "script.js:3563"),
    ("script_handlesavevehicleprofile", "api_user_vehicle", "script.js:3651"),
    ("script_triggergoogleauthlogin", "api_auth_login", "script.js:3705"),
    ("script_loadanalyticsevent", "api_analytics_event", "script.js:50"),
    ("script_loadimpactdashboard", "api_analytics_summary", "script.js:3226"),
    ("script_loadmyimpact", "api_analytics_me", "script.js:2267"),
]
for s, t, loc in CLIENT_CALLS:
    E(s, t, "references", "EXTRACTED", 1.0, F_SCRIPT, loc)

N("script_loadanalyticsevent", "logAnalyticsEvent() - fire-and-forget POST to /api/analytics/event", "code", F_SCRIPT, "script.js:50")
N("script_logchargerdiversion", "logChargerDiversion() - fires charger_diverted analytics event", "code", F_SCRIPT, "script.js:70")
N("script_loadimpactdashboard", "loadImpactDashboard() - admin Overview impact widgets + trend chart", "code", F_SCRIPT, "script.js:3226")
N("script_renderimpacttrendchart", "renderImpactTrendChart() - Chart.js 14-day diversions line chart", "code", F_SCRIPT, "script.js:3262")
N("script_loadmyimpact", "loadMyImpact() - driver's personal impact card on Profile", "code", F_SCRIPT, "script.js:2267")
N("script_populatemodeloptions", "populateModelOptions() - fills MODEL TYPE select for the chosen make", "code", F_SCRIPT, "script.js:3631")

CALL_CHAINS_CALLS = [
    ("script_loadinitialdata", "script_fetchallindiachargers"),
    ("script_loadinitialdata", "script_syncdatabasestate"),
    ("script_loadinitialdata", "script_plotmarkers"),
    ("script_fetchallindiachargers", "script_buildmergedstation"),
    ("script_updatelivestatusforviewport", "script_fetchgoogleplacesforviewport"),
    ("script_updatelivestatusforviewport", "script_mergelivegoogleplaces"),
    ("script_mergelivegoogleplaces", "script_buildmergedstation"),
    ("script_mergelivegoogleplaces", "script_applyoverridesandreports"),
    ("script_plotmarkers", "script_getchargericon"),
    ("script_plotmarkers", "script_createinfowindowcontent"),
    ("script_createinfowindowcontent", "script_gettrustbadgehtml"),
    ("script_createinfowindowcontent", "script_getstationgridloadandprice"),
    ("script_evaluatestationwithml", "script_getgridstressindex"),
    ("script_calculatebestrecommendation", "script_evaluatestationwithml"),
    ("script_plantrip", "script_filteronroutechargers"),
    ("script_plantrip", "script_calculatebestrecommendation"),
    ("script_plantrip", "script_renderroutechargerslist"),
    ("script_plantrip", "script_updaterecommendationdashboard"),
    ("script_plantrip", "script_loadanalyticsevent"),
    ("script_addchargerstopover", "script_plantrip"),
    ("script_addchargerstopover", "script_logchargerdiversion"),
    ("script_selectstationasdestination", "script_addchargerstopover"),
    ("script_selectstationasdestination", "script_logchargerdiversion"),
    ("script_selectstationasdestination", "script_plantrip"),
    ("script_logchargerdiversion", "script_getstationtype"),
    ("script_logchargerdiversion", "script_getstationgridloadandprice"),
    ("script_logchargerdiversion", "script_loadanalyticsevent"),
    ("script_handleauthlogin", "script_checkuservehicleprofile"),
    ("script_handleauthlogin", "script_loadanalyticsevent"),
    ("script_checkuservehicleprofile", "script_openvehiclesetupmodal"),
    ("script_checkuservehicleprofile", "script_applyuservehicletoinputs"),
    ("script_openvehiclesetupmodal", "script_populatemodeloptions"),
    ("script_handlesetupmakechange", "script_populatemodeloptions"),
    ("script_handlesavevehicleprofile", "script_applyuservehicletoinputs"),
    ("script_loadadmindashboard", "script_renderadmincharts"),
    ("script_loadadmindashboard", "script_renderadminstationstable"),
    ("script_loadadmindashboard", "script_loadimpactdashboard"),
    ("script_loadimpactdashboard", "script_renderimpacttrendchart"),
    ("script_renderprofiledetails", "script_loadmyimpact"),
    ("script_saveadminstationedit", "script_syncdatabasestate"),
    ("script_overridechargerstatus", "script_syncdatabasestate"),
    ("script_submitchargerreport", "script_applyoverridesandreports"),
]
for s, t in CALL_CHAINS_CALLS:
    E(s, t, "calls", "EXTRACTED", 1.0, F_SCRIPT)

CALL_CHAINS_DATA = [
    ("script_applyoverridesandreports", "script_adminoverrides"),
    ("script_syncdatabasestate", "script_adminoverrides"),
    ("script_syncdatabasestate", "script_communityreports"),
    ("script_plantrip", "script_directionsservice"),
    ("script_plantrip", "script_activerouteinfo"),
    ("script_plantrip", "script_lastdirectionsresponse"),
    ("script_addchargerstopover", "script_activewaypoint"),
    ("script_handleauthlogin", "script_activeuser"),
    ("script_openvehiclesetupmodal", "script_cachedevmodels"),
    ("script_populatemodeloptions", "script_cachedevmodels"),
    ("script_loadimpactdashboard", "script_adminimpacttrendchart"),
]
for s, t in CALL_CHAINS_DATA:
    E(s, t, "shares_data_with", "EXTRACTED", 1.0, F_SCRIPT)

# ============================================================ index.html
N("index_document", "index.html - single-page shell (login, user app, admin console)", "document", F_INDEX)
SCREENS = [
    ("index_login_screen", "Login Screen (#login-screen, User/Admin roles)", "index.html:27"),
    ("index_register_modal", "Registration Modal (#register-modal)", "index.html:188"),
    ("index_vehicle_setup_modal", "EV Profile Setup Modal - make-then-model cascade (#vehicle-setup-modal)", "index.html:132"),
    ("index_user_app_shell", "User App Shell (#user-app-shell)", "index.html:217"),
    ("index_panel_home", "Home / Map Tab (#panel-home)", "index.html:297"),
    ("index_panel_plan", "Trip Planner Tab (#panel-plan)", "index.html:308"),
    ("index_panel_pricing", "Grid & Pricing Tab (#panel-pricing)", "index.html:463"),
    ("index_panel_profile", "Profile Tab incl. Your GridSync Impact card (#panel-profile)", "index.html:508"),
    ("index_admin_app_shell", "Admin App Shell (#admin-app-shell)", "index.html:609"),
    ("index_admin_panel_dash", "Admin Overview incl. Impact dashboard + trend chart (#admin-panel-dash)", "index.html:631"),
    ("index_admin_panel_stations", "Admin Manage Stations (#admin-panel-stations)", "index.html:774"),
    ("index_admin_panel_analytics", "Admin System Analytics (#admin-panel-analytics)", "index.html:808"),
    ("index_admin_edit_modal", "Admin Station Edit Modal (#admin-edit-station-modal)", "index.html:827"),
]
for nid, label, loc in SCREENS:
    N(nid, label, "document", F_INDEX, loc)
    E("index_document", nid, "references", "EXTRACTED", 1.0, F_INDEX, loc)

HTML_WIRING = [
    ("index_login_screen", "script_switchloginrole", "index.html:60"),
    ("index_login_screen", "script_handleauthlogin", "index.html:64"),
    ("index_vehicle_setup_modal", "script_handlesetupmakechange", "index.html:145"),
    ("index_vehicle_setup_modal", "script_handlesetupmodelchange", "index.html:153"),
    ("index_vehicle_setup_modal", "script_handlesavevehicleprofile", "index.html:142"),
    ("index_panel_plan", "script_togglesimulator", "index.html:438"),
    ("index_panel_profile", "script_openvehiclesetupmodal", "index.html:525"),
    ("index_admin_panel_stations", "script_renderadminstationstable", "index.html:754"),
    ("index_admin_edit_modal", "script_saveadminstationedit", "index.html:854"),
]
for s, t, loc in HTML_WIRING:
    E(s, t, "references", "EXTRACTED", 1.0, F_INDEX, loc)

N("index_toggle_sim_fix", "Fixed: onclick was toggleSimulationDrive() (undefined) -> now toggleSimulator()", "rationale", F_INDEX, "index.html:438")
nodes[-1]["rationale"] = ("The Simulate Drive button called a function name, toggleSimulationDrive(), that was "
                          "never defined anywhere in script.js - only toggleSimulator() existed, called correctly "
                          "elsewhere internally. Clicking the button threw a ReferenceError. Fixed by correcting the "
                          "onclick target to the function that actually exists.")
E("index_toggle_sim_fix", "script_togglesimulator", "rationale_for", "EXTRACTED", 1.0, F_INDEX)

E("script_renderpricingmetrics", "index_panel_pricing", "references", "INFERRED", 0.95, F_SCRIPT)
E("script_renderprofiledetails", "index_panel_profile", "references", "INFERRED", 0.95, F_SCRIPT)
E("script_loadadmindashboard", "index_admin_panel_dash", "references", "INFERRED", 0.95, F_SCRIPT)
E("script_renderadminstationstable", "index_admin_panel_stations", "references", "INFERRED", 0.95, F_SCRIPT)
E("script_renderadmincharts", "index_admin_panel_analytics", "references", "INFERRED", 0.95, F_SCRIPT)
E("script_loadimpactdashboard", "index_admin_panel_dash", "references", "INFERRED", 0.95, F_SCRIPT)
E("script_loadmyimpact", "index_panel_profile", "references", "INFERRED", 0.95, F_SCRIPT)
E("script_openvehiclesetupmodal", "index_vehicle_setup_modal", "references", "INFERRED", 0.95, F_SCRIPT)

N("index_chartjs", "Chart.js (CDN)", "concept", F_INDEX, "index.html:16")
E("script_renderpricingmetrics", "index_chartjs", "references", "EXTRACTED", 1.0, F_SCRIPT)
E("script_renderadmincharts", "index_chartjs", "references", "EXTRACTED", 1.0, F_SCRIPT)
E("script_renderimpacttrendchart", "index_chartjs", "references", "EXTRACTED", 1.0, F_SCRIPT)

N("index_google_maps_config_fetch", "Async Maps key loader: fetch('/api/config') then inject <script src>", "code", F_INDEX, "index.html:15")
E("index_document", "index_google_maps_config_fetch", "references", "EXTRACTED", 1.0, F_INDEX)
E("index_google_maps_config_fetch", "api_config", "references", "EXTRACTED", 1.0, F_INDEX, "index.html:17")

# ============================================================ style.css
N("style_stylesheet", "style.css - dark glass UI system + mobile responsive layer (~3880 lines)", "document", F_STYLE)
E("index_document", "style_stylesheet", "references", "EXTRACTED", 1.0, F_INDEX, "index.html:12")
N("style_mobile_layer", "Mobile responsive layer: safe-area insets, touch targets, admin horizontal-scroll nav, 16px input floor", "rationale", F_STYLE)
nodes[-1]["rationale"] = ("Base (unqueried) styles were already the phone-width layout for the map/planner/pricing/"
                          "profile screens, but the admin console had zero responsive treatment, form inputs were "
                          "under the 16px iOS Safari auto-zoom threshold, and touch targets like .pill-filter were "
                          "under 44px. Added CSS custom properties (--safe-top/--safe-bottom via env(safe-area-inset-*)) "
                          "threaded through #bottom-navigation and .bottom-sheet-panel, a @media (max-width:768px) "
                          "layer for the admin shell (horizontally-scrolling nav, stacked stats, scrollable tables), "
                          "and a blanket 16px input/select/textarea font-size rule. Verified via a live vercel dev "
                          "session at 375px width: zero horizontal page overflow, all touch targets >=40px.")
E("style_mobile_layer", "style_stylesheet", "rationale_for", "EXTRACTED", 1.0, F_STYLE)
E("style_mobile_layer", "index_admin_app_shell", "rationale_for", "EXTRACTED", 1.0, F_STYLE)
E("style_mobile_layer", "index_vehicle_setup_modal", "rationale_for", "EXTRACTED", 1.0, F_STYLE)

# ============================================================ domain concepts
CONCEPTS = [
    ("script_station_fusion_model", "Unified Station Model (OCM static + Google live + admin override + community report)", F_SCRIPT),
    ("script_grid_stress_index", "Grid Stress Index (0-1 from demand MW + frequency Hz)", F_SCRIPT),
    ("script_mlp_recommendation", "6-8-1 MLP Recommendation Network (hardcoded weights)", F_SCRIPT),
    ("script_impact_analytics_pipeline", "Impact/Sustainability Analytics Pipeline (session_start / route_planned / charger_diverted -> kWh/CO2/revenue estimates)", F_SCRIPT),
    ("script_make_first_cascade", "Make-First Vehicle Cascade (car company -> model, ev_models.json split by make/model/modelFull)", F_SCRIPT),
    ("api_graceful_fallback", "Graceful Degradation Pattern (Supabase -> file-backed store -> never a 5xx)", F_HANDLER),
]
for nid, label, src in CONCEPTS:
    N(nid, label, "rationale", src)

CONCEPT_EDGES = [
    ("script_station_fusion_model", "script_buildmergedstation", "rationale_for", 1.0, "EXTRACTED"),
    ("script_station_fusion_model", "script_mergelivegoogleplaces", "rationale_for", 1.0, "EXTRACTED"),
    ("script_grid_stress_index", "script_getgridstressindex", "rationale_for", 1.0, "EXTRACTED"),
    ("script_grid_stress_index", "api_grid_demand", "conceptually_related_to", 0.95, "INFERRED"),
    ("script_mlp_recommendation", "script_stationrecommendationmlp", "rationale_for", 1.0, "EXTRACTED"),
    ("script_mlp_recommendation", "script_evaluatestationwithml", "rationale_for", 1.0, "EXTRACTED"),
    ("script_impact_analytics_pipeline", "script_loadanalyticsevent", "rationale_for", 1.0, "EXTRACTED"),
    ("script_impact_analytics_pipeline", "script_logchargerdiversion", "rationale_for", 1.0, "EXTRACTED"),
    ("script_impact_analytics_pipeline", "api_analytics_event", "rationale_for", 1.0, "EXTRACTED"),
    ("script_impact_analytics_pipeline", "api_analytics_summary", "rationale_for", 1.0, "EXTRACTED"),
    ("script_impact_analytics_pipeline", "api_analytics_me", "rationale_for", 1.0, "EXTRACTED"),
    ("script_impact_analytics_pipeline", "script_loadimpactdashboard", "rationale_for", 0.95, "INFERRED"),
    ("script_impact_analytics_pipeline", "script_loadmyimpact", "rationale_for", 0.95, "INFERRED"),
    ("script_make_first_cascade", "script_populatemodeloptions", "rationale_for", 1.0, "EXTRACTED"),
    ("script_make_first_cascade", "script_handlesetupmakechange", "rationale_for", 1.0, "EXTRACTED"),
    ("script_make_first_cascade", "ev_models_dataset", "rationale_for", 1.0, "EXTRACTED"),
    ("script_make_first_cascade", "api_ev_makes", "conceptually_related_to", 0.9, "INFERRED"),
    ("api_graceful_fallback", "api_grid_demand", "rationale_for", 1.0, "EXTRACTED"),
    ("api_graceful_fallback", "lib_store_persistence_fix", "conceptually_related_to", 0.95, "INFERRED"),
    ("api_graceful_fallback", "api_handler_local_epa_fallback", "rationale_for", 0.95, "INFERRED"),
    ("api_analytics_summary", "script_impact_analytics_pipeline", "semantically_similar_to", 0.85, "INFERRED"),
    ("supabase_users_table", "script_activeuser", "shares_data_with", 1.0, "EXTRACTED"),
    ("ev_models_dataset", "script_cachedevmodels", "shares_data_with", 1.0, "EXTRACTED"),
]
for s, t, rel, score, conf in CONCEPT_EDGES:
    E(s, t, rel, conf, score, F_SCRIPT)

# ============================================================ hyperedges
hyperedges = [
    {
        "id": "impact_dashboard_flow", "label": "Impact Dashboard Data Flow",
        "nodes": ["script_logchargerdiversion", "api_analytics_event", "supabase_analytics_events_table",
                  "api_analytics_summary", "script_loadimpactdashboard", "api_analytics_me", "script_loadmyimpact"],
        "relation": "form", "confidence": "EXTRACTED", "confidence_score": 1.0, "source_file": F_HANDLER,
    },
    {
        "id": "make_model_cascade_flow", "label": "Make-First Vehicle Setup Flow",
        "nodes": ["index_vehicle_setup_modal", "script_openvehiclesetupmodal", "script_handlesetupmakechange",
                  "script_populatemodeloptions", "script_handlesetupmodelchange", "script_handlesavevehicleprofile",
                  "api_user_vehicle", "ev_models_dataset"],
        "relation": "form", "confidence": "EXTRACTED", "confidence_score": 1.0, "source_file": F_SCRIPT,
    },
    {
        "id": "persistence_layer", "label": "Persistence Layer (Supabase-first, file-backed fallback)",
        "nodes": ["api_handler_supabaserequest", "lib_store_readstore", "lib_store_writestore",
                  "api_handler_ensureseeded", "supabase_users_table"],
        "relation": "participate_in", "confidence": "EXTRACTED", "confidence_score": 1.0, "source_file": F_HANDLER,
    },
]

# ============================================================ remaining UI handler wiring
# (index.html attribute wiring + internal call/data edges for the smaller
# window.* handlers not already covered above - closes out isolated nodes.)
MORE_HTML_WIRING = [
    ("index_panel_home", "script_syncsearchdestination"),
    ("index_panel_home", "script_togglefilterpill"),
    ("index_panel_home", "script_togglemaplegend"),
    ("index_panel_home", "script_togglebottomsheetheight"),
    ("index_map_floating_overlay", "script_centermaponuser"),
    ("index_map_floating_overlay", "script_zoommap"),
    ("index_panel_plan", "script_fillgpslocation"),
    ("index_panel_plan", "script_updatebatterysoc"),
    ("index_panel_plan", "script_updateestrange"),
    ("index_panel_plan", "script_updatereserveval"),
    ("index_panel_profile", "script_handleauthlogout"),
    ("index_login_screen", "script_showregistermodal"),
    ("index_register_modal", "script_hideregistermodal"),
    ("index_admin_panel_stations", "script_openadmineditmodal"),
    ("index_admin_edit_modal", "script_closeadmineditmodal"),
    ("index_admin_app_shell", "script_switchadmintab"),
    ("index_bottom_navigation", "script_switchusertab"),
]
N("index_map_floating_overlay", "Floating map controls (locate/zoom, #map-floating-overlay)", "document", F_INDEX)
N("index_bottom_navigation", "Bottom Navigation (#bottom-navigation)", "document", F_INDEX)
E("index_document", "index_map_floating_overlay", "references", "EXTRACTED", 1.0, F_INDEX)
E("index_document", "index_bottom_navigation", "references", "EXTRACTED", 1.0, F_INDEX)
for s, t in MORE_HTML_WIRING:
    E(s, t, "references", "EXTRACTED", 1.0, F_INDEX)

# generated (template-literal) onclick wiring inside script.js itself
MORE_GENERATED_WIRING = [
    ("script_createinfowindowcontent", "script_togglebookmarkstation"),
    ("script_createinfowindowcontent", "script_togglestationdetails"),
    ("script_renderroutechargerslist", "script_focusstationonmap"),
    ("script_renderroutechargerslist", "script_removechargerstopover"),
    ("script_renderadminstationstable", "script_openadmineditmodal"),
    ("script_filteradminmappins", "script_markermap"),
]
for s, t in MORE_GENERATED_WIRING:
    E(s, t, "calls", "EXTRACTED", 1.0, F_SCRIPT)
E("index_admin_panel_map", "script_filteradminmappins", "references", "EXTRACTED", 1.0, F_INDEX)
N("index_admin_panel_map", "Admin Live Control Map (#admin-panel-map)", "document", F_INDEX)
E("index_document", "index_admin_panel_map", "references", "EXTRACTED", 1.0, F_INDEX)

# remaining internal state/data edges
MORE_DATA_EDGES = [
    ("script_initmap", "script_map"),
    ("script_centermaponuser", "script_map"),
    ("script_centermaponuser", "script_userlocation"),
    ("script_startgeolocationtracking", "script_userlocation"),
    ("script_togglefilterpill", "script_chargertypefilter"),
    ("script_togglefilterpill", "script_plotmarkers"),
    ("script_calculatebestrecommendation", "script_recommendedstation"),
    ("script_updaterecommendationdashboard", "script_recommendedstation"),
    ("script_fetchindiaenergyatlasgriddata", "script_livegriddemand"),
    ("script_getgridstressindex", "script_livegriddemand"),
    ("script_updatebatterysoc", "script_vehiclesoc"),
    ("script_updateestrange", "script_vehiclesoc"),
    ("script_updatereserveval", "script_vehiclesoc"),
    ("script_handleauthlogout", "script_activeuser"),
    ("script_switchusertab", "script_renderpricingmetrics"),
    ("script_switchusertab", "script_renderprofiledetails"),
]
for s, t in MORE_DATA_EDGES:
    E(s, t, "shares_data_with", "EXTRACTED", 1.0, F_SCRIPT)
E("script_focusstationonmap", "script_markermap", "shares_data_with", "EXTRACTED", 1.0, F_SCRIPT)

out = {"nodes": nodes, "edges": edges, "hyperedges": hyperedges, "input_tokens": 0, "output_tokens": 0}
Path("graphify-out/.graphify_semantic.json").write_text(json.dumps(out, indent=2, ensure_ascii=False), encoding="utf-8")
print(f"semantic v2: {len(nodes)} nodes, {len(edges)} edges, {len(hyperedges)} hyperedges")
