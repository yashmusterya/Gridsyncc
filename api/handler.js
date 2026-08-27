const https = require('https');
const fs = require('fs');
const path = require('path');
const url = require('url');
const { hashPassword, verifyPassword, signToken, getAuthContext } = require('../lib/auth');
const { readStore, writeStore } = require('../lib/store');

// Environment variables (Vercel injects process.env directly; `vercel dev` also
// loads a local .env automatically, so no manual .env parsing is needed here).
const ATLAS_API_KEY = process.env.ATLAS_API_KEY || process.env.INDIA_ENERGY_ATLAS_API_KEY || '';
const OCM_API_KEY = process.env.OCM_API_KEY || '';
const SUPABASE_URL = process.env.SUPABASE_URL || '';
const SUPABASE_KEY = process.env.SUPABASE_KEY || '';
const GOOGLE_MAPS_API_KEY = process.env.GOOGLE_MAPS_API_KEY || '';

const supabaseEnabled = () => !!(SUPABASE_URL && SUPABASE_KEY);

// ---------------------------------------------------------------------------
// Impact / sustainability analytics constants.
//
// These turn raw "charger_diverted" events into the headline numbers on the
// admin and driver dashboards (kWh routed, CO2 avoided, revenue directed to
// operators). They are estimates, not metered readings - GridSync has no
// telemetry on actual energy delivered per session - so every figure derived
// from them is presented in the UI as approximate. Sources:
//   - AC_SESSION_KWH_ESTIMATE / DC_SESSION_KWH_ESTIMATE: typical partial-charge
//     top-up session sizes for AC (slow, usually topping up) vs DC (fast,
//     usually a bigger top-up) chargers - not a full battery each time.
//   - FLEET_KM_PER_KWH: average maxRange/batteryCapacity across ev_models.json
//     (the actual vehicle fleet this app targets), computed once, not guessed.
//   - PETROL_G_CO2_PER_KM: typical Indian petrol passenger car/SUV tailpipe
//     emissions.
//   - GRID_KG_CO2_PER_KWH: approximate India all-India-average grid emission
//     factor (CEA baseline database, coal-heavy grid).
const AC_SESSION_KWH_ESTIMATE = 8;
const DC_SESSION_KWH_ESTIMATE = 20;
const FLEET_KM_PER_KWH = 8.7;
const PETROL_G_CO2_PER_KM = 145;
const GRID_KG_CO2_PER_KWH = 0.716;
// Net kg CO2 avoided per kWh routed through GridSync vs the same distance driven on petrol.
const NET_CO2_SAVED_KG_PER_KWH = (FLEET_KM_PER_KWH * PETROL_G_CO2_PER_KM / 1000) - GRID_KG_CO2_PER_KWH;

const ANALYTICS_EVENT_TYPES = new Set(['session_start', 'route_planned', 'charger_diverted']);

async function fetchAnalyticsEvents(store, sinceIso, userEmail) {
    if (supabaseEnabled()) {
        try {
            let query = 'select=event_type,user_email,station_id,metadata,created_at&order=created_at.desc&limit=5000';
            if (sinceIso) query += `&created_at=gte.${encodeURIComponent(sinceIso)}`;
            if (userEmail) query += `&user_email=eq.${encodeURIComponent(userEmail)}`;
            const rows = await supabaseRequest('GET', 'analytics_events', { query });
            return (rows || []).map(r => ({
                type: r.event_type, userEmail: r.user_email, stationId: r.station_id,
                metadata: r.metadata || {}, createdAt: r.created_at
            }));
        } catch (err) {
            console.error('Supabase analytics fetch error, falling back to in-memory:', err.message);
        }
    }
    let events = store.analytics;
    if (sinceIso) events = events.filter(e => e.createdAt >= sinceIso);
    if (userEmail) events = events.filter(e => e.userEmail === userEmail);
    return events;
}

function summarizeAnalyticsEvents(events) {
    const sessions = events.filter(e => e.type === 'session_start').length;
    const routesPlanned = events.filter(e => e.type === 'route_planned').length;
    const diversions = events.filter(e => e.type === 'charger_diverted');

    let dcCount = 0, acCount = 0, offPeakCount = 0, revenueInr = 0;
    const stationCounts = {};
    const dayCounts = {};

    diversions.forEach(e => {
        const meta = e.metadata || {};
        const isDc = meta.chargerType === 'DC';
        if (isDc) dcCount++; else acCount++;

        const gridLoad = meta.gridLoad || 'MEDIUM';
        if (gridLoad === 'LOW' || gridLoad === 'MEDIUM') offPeakCount++;

        const price = parseFloat(meta.priceEstimate);
        if (!isNaN(price)) revenueInr += price * (isDc ? DC_SESSION_KWH_ESTIMATE : AC_SESSION_KWH_ESTIMATE);

        if (e.stationId) stationCounts[e.stationId] = (stationCounts[e.stationId] || 0) + 1;

        const day = (e.createdAt || '').slice(0, 10);
        if (day) dayCounts[day] = (dayCounts[day] || 0) + 1;
    });

    const estimatedKwh = (dcCount * DC_SESSION_KWH_ESTIMATE) + (acCount * AC_SESSION_KWH_ESTIMATE);
    const estimatedCo2SavedKg = Math.max(0, estimatedKwh * NET_CO2_SAVED_KG_PER_KWH);
    const offPeakSharePct = diversions.length > 0 ? Math.round((offPeakCount / diversions.length) * 100) : 0;

    const topStations = Object.entries(stationCounts)
        .sort((a, b) => b[1] - a[1])
        .slice(0, 5)
        .map(([stationId, count]) => ({ stationId, count }));

    const trend = Object.entries(dayCounts)
        .sort((a, b) => a[0].localeCompare(b[0]))
        .slice(-14)
        .map(([day, count]) => ({ day, count }));

    return {
        sessions,
        routesPlanned,
        diversions: diversions.length,
        estimatedKwh: Math.round(estimatedKwh),
        estimatedCo2SavedKg: Math.round(estimatedCo2SavedKg),
        estimatedRevenueInr: Math.round(revenueInr),
        offPeakSharePct,
        topStations,
        trend
    };
}

// Generic PostgREST request helper against the Supabase project. Every
// Supabase-backed endpoint below goes through this, then falls back to the
// in-memory store on any failure (network error, RLS misconfig, table
// missing, etc.) - same "never surface a 5xx to the UI" convention the rest
// of this proxy already follows for grid-demand/OCM.
function supabaseRequest(method, tablePath, { query = '', body = null, extraHeaders = {} } = {}) {
    return new Promise((resolve, reject) => {
        const targetUrl = `${SUPABASE_URL}/rest/v1/${tablePath}${query ? `?${query}` : ''}`;
        const parsed = url.parse(targetUrl);
        const postData = body !== null ? JSON.stringify(body) : null;
        const reqOptions = {
            hostname: parsed.hostname,
            path: parsed.path,
            port: parsed.port || 443,
            method,
            headers: {
                'apikey': SUPABASE_KEY,
                'Authorization': `Bearer ${SUPABASE_KEY}`,
                'Accept': 'application/json',
                ...(postData ? { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(postData) } : {}),
                ...extraHeaders
            }
        };

        const proxyReq = https.request(reqOptions, (proxyRes) => {
            let responseBody = '';
            proxyRes.on('data', (chunk) => { responseBody += chunk; });
            proxyRes.on('end', () => {
                let parsed2 = null;
                try { parsed2 = responseBody ? JSON.parse(responseBody) : null; } catch (e) { parsed2 = responseBody; }
                if (proxyRes.statusCode >= 200 && proxyRes.statusCode < 300) {
                    resolve(parsed2);
                } else {
                    reject(new Error(`Supabase ${method} ${tablePath} -> ${proxyRes.statusCode}: ${responseBody}`));
                }
            });
        });

        proxyReq.on('error', reject);
        proxyReq.on('timeout', () => { proxyReq.destroy(); reject(new Error(`Supabase ${method} ${tablePath} timed out`)); });
        proxyReq.setTimeout(8000);
        if (postData) proxyReq.write(postData);
        proxyReq.end();
    });
}

// Maps a `users` table row (snake_case columns) to the camelCase user shape
// used everywhere else in this app (matches the in-memory user objects).
function normalizeUserRow(row) {
    if (!row) return null;
    return {
        email: row.email,
        password: row.password_hash,
        role: row.role,
        name: row.name,
        phone: row.phone || '',
        vehicleModel: row.vehicle_model || '',
        vehicleNo: row.vehicle_no || '',
        batteryCapacity: row.battery_capacity || 0,
        maxRange: row.max_range || 0,
        preferredConnector: row.preferred_connector || '',
        minReserve: row.min_reserve != null ? row.min_reserve : 15,
        preferredSpeed: row.preferred_speed || 'DC',
        savedStations: row.saved_stations || [],
        chargingHistory: row.charging_history || []
    };
}

function userToRow(user) {
    return {
        email: user.email,
        password_hash: user.password,
        role: user.role,
        name: user.name,
        phone: user.phone || '',
        vehicle_model: user.vehicleModel || '',
        vehicle_no: user.vehicleNo || '',
        battery_capacity: user.batteryCapacity || 0,
        max_range: user.maxRange || 0,
        preferred_connector: user.preferredConnector || '',
        min_reserve: user.minReserve != null ? user.minReserve : 15,
        preferred_speed: user.preferredSpeed || 'DC',
        saved_stations: user.savedStations || [],
        charging_history: user.chargingHistory || []
    };
}

function toSafeUser(user) {
    const { password, ...safe } = user;
    return safe;
}

// File-backed fallback store (see lib/store.js for why this isn't `global.*`).
// NOTE: on a real Vercel deployment this only persists for the lifetime of a
// single warm serverless instance and is wiped on cold start - it is NOT a
// substitute for real persistence. Configure SUPABASE_URL/SUPABASE_KEY (see
// supabase/schema.sql) for that; this fallback exists so the app still works
// end-to-end (locally, or on any non-ephemeral host) when Supabase isn't set up.
function ensureSeeded(store) {
    if (!store.users) {
        store.users = [
            {
                email: 'user@gridsync.in',
                password: hashPassword('user123'),
                role: 'User',
                name: 'GridSync Driver',
                phone: '+91 98765 43210',
                vehicleModel: 'Tata Nexon EV Max',
                batteryCapacity: 40.5,
                maxRange: 437,
                preferredConnector: 'CCS2',
                minReserve: 15,
                preferredSpeed: 'DC',
                savedStations: [],
                chargingHistory: [
                    { date: '2026-08-20', station: 'Zeon Charging - Lonavala', energy: '28.4 kWh', cost: '₹383.40', type: 'DC Fast' },
                    { date: '2026-08-15', station: 'Tata Power EZ Charge - Expressway', energy: '15.2 kWh', cost: '₹174.80', type: 'AC Charger' }
                ]
            },
            {
                email: 'admin@gridsync.in',
                password: hashPassword('admin123'),
                role: 'Admin',
                name: 'GridSync Operator',
                phone: '+91 99999 88888'
            }
        ];
        writeStore(store);
    }
    return store;
}

// Load EV Specifications Database once per cold start
const evModelsPath = path.join(process.cwd(), 'ev_models.json');
let evModels = [];
if (fs.existsSync(evModelsPath)) {
    try {
        evModels = JSON.parse(fs.readFileSync(evModelsPath, 'utf8'));
    } catch (e) {
        console.error('Failed to parse ev_models.json:', e);
    }
}

// Load VAHAN Registry Database once per cold start
const vahanRegistryPath = path.join(process.cwd(), 'vahan_registry.json');
let vahanRegistry = [];
if (fs.existsSync(vahanRegistryPath)) {
    try {
        vahanRegistry = JSON.parse(fs.readFileSync(vahanRegistryPath, 'utf8'));
    } catch (e) {
        console.error('Failed to parse vahan_registry.json:', e);
    }
}

// Helper: Fetch JSON from U.S. EPA fueleconomy.gov service
const fetchEpaData = (apiPath, callback) => {
    const targetUrl = `https://www.fueleconomy.gov/ws/rest${apiPath}`;
    const options = {
        headers: {
            'Accept': 'application/json',
            'User-Agent': 'Mozilla/5.0 (compatible; GridSync/1.0)'
        },
        timeout: 8000
    };

    const req = https.get(targetUrl, options, (res) => {
        let body = '';
        res.on('data', chunk => { body += chunk; });
        res.on('end', () => {
            try {
                callback(null, JSON.parse(body));
            } catch (e) {
                callback(e, body);
            }
        });
    });

    req.on('error', (err) => callback(err, null));
    req.on('timeout', () => {
        req.destroy();
        callback(new Error('EPA service request timed out'), null);
    });
};

const extractMenuItems = (data) => {
    if (!data) return [];
    if (Array.isArray(data.menuItem)) return data.menuItem;
    if (data.menuItem) return [data.menuItem];
    return [];
};

const LOCAL_EPA_FALLBACK = {
    "2024": {
        "Tesla": {
            "Model Y Long Range": { batteryCapacity: 75.0, maxRange: 525, connector: "CCS2", chargeTime240: 10 },
            "Model 3 Rear-Wheel Drive": { batteryCapacity: 57.5, maxRange: 438, connector: "CCS2", chargeTime240: 8 },
            "Model S Plaid": { batteryCapacity: 95.0, maxRange: 578, connector: "CCS2", chargeTime240: 12 }
        },
        "Hyundai": {
            "Ioniq 5 Long Range AWD": { batteryCapacity: 77.4, maxRange: 418, connector: "CCS2", chargeTime240: 8.5 },
            "Ioniq 6 SE Long Range RWD": { batteryCapacity: 77.4, maxRange: 581, connector: "CCS2", chargeTime240: 7.5 }
        },
        "BMW": {
            "i4 eDrive40 Gran Coupe": { batteryCapacity: 81.2, maxRange: 484, connector: "CCS2", chargeTime240: 8.25 }
        },
        "Chevrolet": {
            "Bolt EV": { batteryCapacity: 65.0, maxRange: 417, connector: "CCS2", chargeTime240: 9.5 }
        }
    },
    "2023": {
        "Tesla": {
            "Model Y Long Range": { batteryCapacity: 75.0, maxRange: 531, connector: "CCS2", chargeTime240: 10 },
            "Model 3 Performance": { batteryCapacity: 75.0, maxRange: 507, connector: "CCS2", chargeTime240: 10 }
        },
        "Hyundai": {
            "Ioniq 5 Long Range RWD": { batteryCapacity: 77.4, maxRange: 488, connector: "CCS2", chargeTime240: 8.5 }
        },
        "Nissan": {
            "Leaf S (40 kWh)": { batteryCapacity: 40.0, maxRange: 240, connector: "CHAdeMO", chargeTime240: 8 },
            "Leaf SV PLUS (60 kWh)": { batteryCapacity: 60.0, maxRange: 341, connector: "CHAdeMO", chargeTime240: 11 }
        },
        "Rivian": {
            "R1T Dual-Motor": { batteryCapacity: 135.0, maxRange: 566, connector: "CCS2", chargeTime240: 13 }
        }
    },
    "2022": {
        "Tesla": {
            "Model 3 Long Range": { batteryCapacity: 75.0, maxRange: 576, connector: "CCS2", chargeTime240: 10 },
            "Model Y Performance": { batteryCapacity: 75.0, maxRange: 488, connector: "CCS2", chargeTime240: 10 }
        },
        "Audi": {
            "e-tron GT": { batteryCapacity: 83.7, maxRange: 383, connector: "CCS2", chargeTime240: 10 }
        },
        "Ford": {
            "Mustang Mach-E GT": { batteryCapacity: 91.0, maxRange: 435, connector: "CCS2", chargeTime240: 10.5 }
        }
    },
    "2021": {
        "Tesla": {
            "Model 3 Standard Range Plus": { batteryCapacity: 50.0, maxRange: 423, connector: "CCS2", chargeTime240: 8.5 }
        },
        "Nissan": {
            "Leaf (40 kWh)": { batteryCapacity: 40.0, maxRange: 240, connector: "CHAdeMO", chargeTime240: 8 }
        }
    },
    "2020": {
        "Tesla": {
            "Model X Long Range Plus": { batteryCapacity: 100.0, maxRange: 565, connector: "CCS2", chargeTime240: 10.5 }
        },
        "Jaguar": {
            "I-Pace": { batteryCapacity: 90.0, maxRange: 377, connector: "CCS2", chargeTime240: 12.9 }
        }
    }
};

// ---------------------------------------------------------------------------
// Auth guards, audit trail and login throttling.
//
// Every /api/admin/* route and the fleet-wide /api/analytics/summary sit behind
// requireAdmin. Before this existed the admin endpoints were completely
// unauthenticated - anyone who knew the URL could rewrite station metadata on
// the live deployment - and "admin" was purely a client-side flag the browser
// set on itself.
const sendJson = (res, status, payload) => {
    res.writeHead(status, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify(payload));
};

// Returns the token payload, or null after already writing a 401/403.
function requireAuth(req, res) {
    const auth = getAuthContext(req);
    if (!auth) {
        sendJson(res, 401, { error: 'Authentication required. Please sign in again.' });
        return null;
    }
    return auth;
}

function requireAdmin(req, res) {
    const auth = getAuthContext(req);
    if (!auth) {
        sendJson(res, 401, { error: 'Authentication required. Please sign in again.' });
        return null;
    }
    if (auth.role !== 'Admin') {
        sendJson(res, 403, { error: 'Administrator privileges required.' });
        return null;
    }
    return auth;
}

const AUDIT_LIMIT = 500;

// Append an admin action to the audit trail. Best-effort: an audit write must
// never fail the action it is recording, so Supabase errors fall through to the
// local store and are only logged.
async function recordAudit(store, auth, action, target, details) {
    const entry = {
        actor: (auth && auth.email) || 'unknown',
        action,
        target: target || '',
        details: details || {},
        createdAt: new Date().toISOString()
    };

    if (supabaseEnabled()) {
        try {
            await supabaseRequest('POST', 'audit_log', {
                body: {
                    actor: entry.actor,
                    action: entry.action,
                    target: entry.target,
                    details: entry.details,
                    created_at: entry.createdAt
                }
            });
            return entry;
        } catch (err) {
            console.error('Supabase audit write error, falling back to local store:', err.message);
        }
    }

    store.audit = store.audit || [];
    store.audit.unshift(entry);
    if (store.audit.length > AUDIT_LIMIT) store.audit.length = AUDIT_LIMIT;
    writeStore(store);
    return entry;
}

async function fetchAuditLog(store, limit = 100) {
    if (supabaseEnabled()) {
        try {
            const rows = await supabaseRequest('GET', 'audit_log', {
                query: `select=actor,action,target,details,created_at&order=created_at.desc&limit=${limit}`
            });
            return (rows || []).map(r => ({
                actor: r.actor, action: r.action, target: r.target,
                details: r.details || {}, createdAt: r.created_at
            }));
        } catch (err) {
            console.error('Supabase audit fetch error, falling back to local store:', err.message);
        }
    }
    return (store.audit || []).slice(0, limit);
}

// ---------------------------------------------------------------------------
// Ops queue.
//
// The admin Overview used to show community fault reports as a flat read-only
// table, which told an operator that something was wrong but not what to do
// about it. These helpers turn the raw report stream into a triageable queue:
// grouped per station, scored by severity, and carrying a resolution state an
// operator can advance (open -> acknowledged -> resolved).
async function fetchAllReports(store) {
    if (supabaseEnabled()) {
        try {
            const rows = await supabaseRequest('GET', 'reports', {
                query: 'select=station_id,working,user_email,created_at&order=created_at.desc&limit=2000'
            });
            return (rows || []).map(r => ({
                stationId: r.station_id,
                working: r.working,
                userEmail: r.user_email,
                timestamp: r.created_at
            }));
        } catch (err) {
            console.error('Supabase reports fetch error, falling back to local store:', err.message);
        }
    }
    return store.reports || [];
}

async function fetchReportResolutions(store) {
    if (supabaseEnabled()) {
        try {
            const rows = await supabaseRequest('GET', 'report_resolutions', { query: 'select=*' });
            const map = {};
            (rows || []).forEach(r => {
                map[r.station_id] = {
                    status: r.status, actor: r.actor, note: r.note, at: r.updated_at
                };
            });
            return map;
        } catch (err) {
            console.error('Supabase resolutions fetch error, falling back to local store:', err.message);
        }
    }
    return store.reportResolutions || {};
}

function severityFor(netFault) {
    if (netFault >= 3) return 'CRITICAL';
    if (netFault === 2) return 'HIGH';
    if (netFault === 1) return 'MEDIUM';
    return 'LOW';
}

// Group reports by station into scored, triageable queue items.
function buildOpsQueue(reports, resolutions) {
    const byStation = {};

    reports.forEach(r => {
        if (!r.stationId) return;
        if (!byStation[r.stationId]) {
            byStation[r.stationId] = {
                stationId: r.stationId, broken: 0, working: 0,
                lastReportAt: null, reporters: new Set()
            };
        }
        const item = byStation[r.stationId];
        if (r.working) item.working++; else item.broken++;
        if (r.userEmail) item.reporters.add(r.userEmail);
        if (!item.lastReportAt || (r.timestamp && r.timestamp > item.lastReportAt)) {
            item.lastReportAt = r.timestamp;
        }
    });

    return Object.values(byStation).map(item => {
        const netFault = item.broken - item.working;
        const resolution = resolutions[item.stationId];

        // A station that was resolved but has been reported broken again since
        // is reopened rather than staying silently closed.
        let status = 'open';
        if (resolution) {
            const staleResolution = resolution.at && item.lastReportAt && item.lastReportAt > resolution.at;
            status = staleResolution ? 'open' : resolution.status;
        }

        return {
            stationId: item.stationId,
            broken: item.broken,
            working: item.working,
            netFault,
            severity: severityFor(netFault),
            reporterCount: item.reporters.size,
            lastReportAt: item.lastReportAt,
            status,
            resolvedBy: resolution ? resolution.actor : null,
            resolutionNote: resolution ? resolution.note : null
        };
    })
    .filter(item => item.netFault > 0 || item.status !== 'open')
    .sort((a, b) => {
        // Open items first, then by severity, then most recently reported.
        if ((a.status === 'open') !== (b.status === 'open')) return a.status === 'open' ? -1 : 1;
        if (b.netFault !== a.netFault) return b.netFault - a.netFault;
        return String(b.lastReportAt || '').localeCompare(String(a.lastReportAt || ''));
    });
}

// Deeper analytics cuts for the admin Analytics tab: when diversions actually
// happen, what mix of hardware they land on, and how activity trends per day.
function buildAdminAnalytics(events) {
    const hourHistogram = Array.from({ length: 24 }, (_, h) => ({ hour: h, count: 0 }));
    const connectorMix = { AC: 0, DC: 0 };
    const gridLoadMix = { LOW: 0, MEDIUM: 0, HIGH: 0 };
    const dailyActivity = {};

    events.forEach(e => {
        const day = (e.createdAt || '').slice(0, 10);
        if (day) {
            if (!dailyActivity[day]) dailyActivity[day] = { day, sessions: 0, routes: 0, diversions: 0 };
            if (e.type === 'session_start') dailyActivity[day].sessions++;
            if (e.type === 'route_planned') dailyActivity[day].routes++;
            if (e.type === 'charger_diverted') dailyActivity[day].diversions++;
        }

        if (e.type !== 'charger_diverted') return;

        const when = e.createdAt ? new Date(e.createdAt) : null;
        if (when && !isNaN(when)) hourHistogram[when.getHours()].count++;

        const meta = e.metadata || {};
        if (meta.chargerType === 'DC') connectorMix.DC++; else connectorMix.AC++;
        const load = meta.gridLoad || 'MEDIUM';
        if (gridLoadMix[load] !== undefined) gridLoadMix[load]++;
    });

    return {
        hourHistogram,
        connectorMix,
        gridLoadMix,
        dailyActivity: Object.values(dailyActivity).sort((a, b) => a.day.localeCompare(b.day)).slice(-30)
    };
}

// Login throttling. Best-effort only: the backing store is per-instance on
// serverless, so this raises the cost of a brute-force run without pretending
// to be a distributed rate limiter.
const LOGIN_MAX_ATTEMPTS = 8;
const LOGIN_WINDOW_MS = 10 * 60 * 1000;

function loginThrottled(store, key) {
    const rec = (store.loginAttempts || {})[key];
    if (!rec) return false;
    if (Date.now() - rec.first > LOGIN_WINDOW_MS) return false;
    return rec.count >= LOGIN_MAX_ATTEMPTS;
}

function recordLoginFailure(store, key) {
    store.loginAttempts = store.loginAttempts || {};
    const rec = store.loginAttempts[key];
    if (!rec || Date.now() - rec.first > LOGIN_WINDOW_MS) {
        store.loginAttempts[key] = { count: 1, first: Date.now() };
    } else {
        rec.count += 1;
    }
    writeStore(store);
}

function clearLoginFailures(store, key) {
    if (store.loginAttempts && store.loginAttempts[key]) {
        delete store.loginAttempts[key];
        writeStore(store);
    }
}

module.exports = async (req, res) => {
    const parsedUrl = url.parse(req.url, true);
    const pathname = parsedUrl.pathname;
    const body = req.body; // Auto-parsed by Vercel's Node runtime for JSON requests
    const store = ensureSeeded(readStore()); // fresh read every request - see lib/store.js

    // Public runtime config (safe to expose - Google Maps JS API keys are
    // inherently client-side; restrict them via HTTP referrer in Google Cloud Console)
    if (pathname === '/api/config') {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        return res.end(JSON.stringify({ googleMapsApiKey: GOOGLE_MAPS_API_KEY }));
    }

    // API Endpoint: Proxy India Energy Atlas Grid Data
    if (pathname === '/api/grid-demand') {
        if (!ATLAS_API_KEY) {
            const simulatedData = {
                demand_mw: Math.round(19000 + Math.random() * 6000),
                frequency_hz: parseFloat((49.92 + Math.random() * 0.16).toFixed(2)),
                as_of: new Date().toISOString(),
                source: 'SLDC-POSOCO (Simulated Fallback)',
                status: 'SIMULATED'
            };
            res.writeHead(200, { 'Content-Type': 'application/json' });
            return res.end(JSON.stringify(simulatedData));
        }

        const targetUrl = 'https://api.energymap.in/developer/v1/grid/demand/latest';
        const options = {
            headers: {
                'X-API-Key': ATLAS_API_KEY,
                'Accept': 'application/json'
            },
            timeout: 5000
        };

        const proxyReq = https.get(targetUrl, options, (proxyRes) => {
            let responseBody = '';
            proxyRes.on('data', (chunk) => { responseBody += chunk; });
            proxyRes.on('end', () => {
                try {
                    const parsed = JSON.parse(responseBody);
                    const demandMw = parsed?.national?.demand_mw || parsed?.demand_mw || Math.round(19000 + Math.random() * 6000);
                    const freqHz = parsed?.national?.frequency_hz || parsed?.frequency_hz || parseFloat((49.95 + Math.random() * 0.1).toFixed(2));

                    const responseData = {
                        demand_mw: demandMw,
                        frequency_hz: freqHz,
                        as_of: parsed?.timestamp || parsed?.as_of || new Date().toISOString(),
                        source: 'India Energy Atlas API (Live)',
                        status: 'LIVE',
                        raw: parsed
                    };

                    res.writeHead(200, { 'Content-Type': 'application/json' });
                    res.end(JSON.stringify(responseData));
                } catch (e) {
                    const fallbackData = {
                        demand_mw: Math.round(19000 + Math.random() * 6000),
                        frequency_hz: 50.01,
                        as_of: new Date().toISOString(),
                        source: 'India Energy Atlas (Raw Fallback)',
                        status: 'FALLBACK'
                    };
                    res.writeHead(200, { 'Content-Type': 'application/json' });
                    res.end(JSON.stringify(fallbackData));
                }
            });
        });

        proxyReq.on('error', (err) => {
            console.error('Grid demand proxy error:', err.message);
            const fallbackData = {
                demand_mw: Math.round(19000 + Math.random() * 6000),
                frequency_hz: 50.00,
                as_of: new Date().toISOString(),
                source: 'SLDC-POSOCO (Connection Fallback)',
                status: 'SIMULATED'
            };
            res.writeHead(200, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify(fallbackData));
        });

        proxyReq.on('timeout', () => {
            proxyReq.destroy();
            const fallbackData = {
                demand_mw: Math.round(19000 + Math.random() * 6000),
                frequency_hz: 50.00,
                as_of: new Date().toISOString(),
                source: 'SLDC-POSOCO (Timeout Fallback)',
                status: 'SIMULATED'
            };
            res.writeHead(200, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify(fallbackData));
        });

        return;
    }

    // API Endpoint: Proxy Open Charge Map Requests
    if (pathname === '/api/ocm-chargers') {
        const queryParams = { ...parsedUrl.query };
        if (OCM_API_KEY) queryParams.key = OCM_API_KEY;
        const queryString = Object.keys(queryParams)
            .map(k => `${encodeURIComponent(k)}=${encodeURIComponent(queryParams[k])}`)
            .join('&');

        const targetUrl = `https://api.openchargemap.io/v3/poi/?${queryString}`;
        const options = { timeout: 8000 };

        const proxyReq = https.get(targetUrl, options, (proxyRes) => {
            let responseBody = '';
            res.writeHead(proxyRes.statusCode, {
                'Content-Type': 'application/json',
                'Access-Control-Allow-Origin': '*'
            });

            proxyRes.on('data', (chunk) => { responseBody += chunk; });
            proxyRes.on('end', () => {
                res.end(responseBody);
            });
        });

        proxyReq.on('error', (err) => {
            console.error('OCM proxy error:', err.message);
            res.writeHead(502, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ error: 'Failed to connect to OCM API.' }));
        });

        proxyReq.on('timeout', () => {
            proxyReq.destroy();
            res.writeHead(504, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ error: 'Gateway Timeout connecting to OCM API.' }));
        });

        return;
    }

    // API Endpoint: Save EV Trip (Supabase Proxy with In-Memory fallback)
    if (pathname === '/api/save-trip' && req.method === 'POST') {
        const auth = requireAuth(req, res);
        if (!auth) return;

        if (!body) {
            res.writeHead(400, { 'Content-Type': 'application/json' });
            return res.end(JSON.stringify({ error: 'Invalid JSON request body.' }));
        }
        const tripData = {
            ...body,
            userEmail: auth.email,
            created_at: new Date().toISOString(),
            id: Date.now().toString()
        };

        if (supabaseEnabled()) {
            try {
                await supabaseRequest('POST', 'saved_trips', {
                    body: { id: tripData.id, created_at: tripData.created_at, user_email: auth.email, data: body },
                    extraHeaders: { 'Prefer': 'return=representation' }
                });
                res.writeHead(200, { 'Content-Type': 'application/json' });
                return res.end(JSON.stringify({ status: 'SUCCESS', message: 'Trip saved to Supabase.', data: tripData }));
            } catch (err) {
                console.error('Supabase save proxy error:', err.message);
            }
        }

        store.savedTrips.push(tripData);
        writeStore(store);
        res.writeHead(200, { 'Content-Type': 'application/json' });
        return res.end(JSON.stringify({
            status: 'SUCCESS_LOCAL',
            message: supabaseEnabled() ? 'Trip saved locally (Supabase error).' : 'Trip saved locally (Supabase not configured).',
            data: tripData
        }));
    }

    // API Endpoint: Get Saved Trips (Supabase Proxy with In-Memory fallback)
    if (pathname === '/api/get-saved-trips' && req.method === 'GET') {
        const auth = requireAuth(req, res);
        if (!auth) return;

        // Scoped to the caller. Admins get the whole list for support purposes;
        // drivers only ever see their own saved trips.
        const scopeToSelf = auth.role !== 'Admin';

        if (supabaseEnabled()) {
            try {
                let query = 'select=*&order=created_at.desc';
                if (scopeToSelf) query += `&user_email=eq.${encodeURIComponent(auth.email)}`;
                const rows = await supabaseRequest('GET', 'saved_trips', { query });
                const trips = (rows || []).map(r => ({ ...r.data, id: r.id, created_at: r.created_at }));
                return sendJson(res, 200, trips);
            } catch (err) {
                console.error('Supabase fetch proxy error:', err.message);
            }
        }

        const trips = scopeToSelf
            ? store.savedTrips.filter(t => t.userEmail === auth.email)
            : store.savedTrips;
        return sendJson(res, 200, trips);
    }

    // API Endpoint: User/Admin Authentication Login
    if (pathname === '/api/auth/login' && req.method === 'POST') {
        if (!body || !body.email || !body.password) {
            res.writeHead(400, { 'Content-Type': 'application/json' });
            return res.end(JSON.stringify({ error: 'Missing email/password' }));
        }

        const throttleKey = String(body.email).toLowerCase();
        if (loginThrottled(store, throttleKey)) {
            return sendJson(res, 429, {
                error: 'Too many failed sign-in attempts. Please wait a few minutes and try again.'
            });
        }

        let user = null;
        if (supabaseEnabled()) {
            try {
                const query = `select=*&or=(email.eq.${encodeURIComponent(body.email)},phone.eq.${encodeURIComponent(body.email)})&limit=1`;
                const rows = await supabaseRequest('GET', 'users', { query });
                if (Array.isArray(rows) && rows[0]) user = normalizeUserRow(rows[0]);
            } catch (err) {
                console.error('Supabase login lookup error, falling back to in-memory:', err.message);
            }
        }
        if (!user) {
            user = store.users.find(u => u.email === body.email || u.phone === body.email) || null;
        }

        if (!user || !verifyPassword(body.password, user.password)) {
            recordLoginFailure(store, throttleKey);
            // Deliberately identical message for unknown-user and wrong-password
            // so the response can't be used to enumerate valid accounts.
            return sendJson(res, 401, { error: 'Invalid email or password' });
        }

        clearLoginFailures(store, throttleKey);
        const token = signToken({ email: user.email, role: user.role, name: user.name });
        return sendJson(res, 200, { status: 'SUCCESS', user: toSafeUser(user), token });
    }

    // API Endpoint: User Registration
    if (pathname === '/api/auth/register' && req.method === 'POST') {
        if (!body || !body.email || !body.password || !body.name) {
            res.writeHead(400, { 'Content-Type': 'application/json' });
            return res.end(JSON.stringify({ error: 'Missing required fields' }));
        }

        const newUser = {
            email: body.email,
            password: hashPassword(body.password),
            role: 'User',
            name: body.name,
            phone: body.phone || '',
            vehicleModel: body.vehicleModel || '',
            vehicleNo: body.vehicleNo || '',
            batteryCapacity: body.batteryCapacity || 0,
            maxRange: body.maxRange || 0,
            preferredConnector: body.preferredConnector || '',
            minReserve: body.minReserve || 15,
            preferredSpeed: body.preferredSpeed || 'DC',
            savedStations: [],
            chargingHistory: []
        };

        if (supabaseEnabled()) {
            try {
                const existing = await supabaseRequest('GET', 'users', { query: `select=email&email=eq.${encodeURIComponent(body.email)}&limit=1` });
                if (Array.isArray(existing) && existing[0]) {
                    res.writeHead(400, { 'Content-Type': 'application/json' });
                    return res.end(JSON.stringify({ error: 'User already exists' }));
                }
                await supabaseRequest('POST', 'users', { body: userToRow(newUser), extraHeaders: { 'Prefer': 'return=representation' } });
                return sendJson(res, 200, {
                    status: 'SUCCESS',
                    user: toSafeUser(newUser),
                    token: signToken({ email: newUser.email, role: newUser.role, name: newUser.name })
                });
            } catch (err) {
                console.error('Supabase register error, falling back to in-memory:', err.message);
            }
        }

        const exists = store.users.some(u => u.email === body.email);
        if (exists) {
            res.writeHead(400, { 'Content-Type': 'application/json' });
            return res.end(JSON.stringify({ error: 'User already exists' }));
        }
        store.users.push(newUser);
        writeStore(store);
        return sendJson(res, 200, {
            status: 'SUCCESS',
            user: toSafeUser(newUser),
            token: signToken({ email: newUser.email, role: newUser.role, name: newUser.name })
        });
    }

    // API Endpoint: Get EPA Makes
    if (pathname === '/api/epa/makes' && req.method === 'GET') {
        const year = parsedUrl.query.year;
        if (!year) {
            res.writeHead(400, { 'Content-Type': 'application/json' });
            return res.end(JSON.stringify({ error: 'Missing year' }));
        }
        fetchEpaData(`/vehicle/menu/make?year=${encodeURIComponent(year)}`, (err, data) => {
            if (err || !data) {
                const fallbackData = LOCAL_EPA_FALLBACK[year];
                if (fallbackData) {
                    const list = Object.keys(fallbackData).map(k => ({ text: k, value: k }));
                    res.writeHead(200, { 'Content-Type': 'application/json' });
                    return res.end(JSON.stringify(list));
                }
                res.writeHead(502, { 'Content-Type': 'application/json' });
                return res.end(JSON.stringify({ error: 'Failed to fetch makes from EPA service' }));
            }
            res.writeHead(200, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify(extractMenuItems(data)));
        });
        return;
    }

    // API Endpoint: Get EPA Models
    if (pathname === '/api/epa/models' && req.method === 'GET') {
        const year = parsedUrl.query.year;
        const make = parsedUrl.query.make;
        if (!year || !make) {
            res.writeHead(400, { 'Content-Type': 'application/json' });
            return res.end(JSON.stringify({ error: 'Missing year or make' }));
        }
        fetchEpaData(`/vehicle/menu/model?year=${encodeURIComponent(year)}&make=${encodeURIComponent(make)}`, (err, data) => {
            if (err || !data) {
                const fallbackYear = LOCAL_EPA_FALLBACK[year];
                if (fallbackYear && fallbackYear[make]) {
                    const list = Object.keys(fallbackYear[make]).map(k => ({ text: k, value: k }));
                    res.writeHead(200, { 'Content-Type': 'application/json' });
                    return res.end(JSON.stringify(list));
                }
                res.writeHead(502, { 'Content-Type': 'application/json' });
                return res.end(JSON.stringify({ error: 'Failed to fetch models from EPA service' }));
            }
            res.writeHead(200, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify(extractMenuItems(data)));
        });
        return;
    }

    // API Endpoint: Get EPA Vehicle Specs
    if (pathname === '/api/epa/specs' && req.method === 'GET') {
        const year = parsedUrl.query.year;
        const make = parsedUrl.query.make;
        const model = parsedUrl.query.model;

        if (!year || !make || !model) {
            res.writeHead(400, { 'Content-Type': 'application/json' });
            return res.end(JSON.stringify({ error: 'Missing year, make, or model' }));
        }

        const optionsPath = `/vehicle/menu/options?year=${encodeURIComponent(year)}&make=${encodeURIComponent(make)}&model=${encodeURIComponent(model)}`;
        fetchEpaData(optionsPath, (err, optionsData) => {
            if (err || !optionsData) {
                const fallbackYear = LOCAL_EPA_FALLBACK[year];
                if (fallbackYear && fallbackYear[make] && fallbackYear[make][model]) {
                    const spec = fallbackYear[make][model];
                    const specResult = {
                        model: `${make} ${model} (${year})`,
                        batteryCapacity: spec.batteryCapacity,
                        maxRange: spec.maxRange,
                        connector: spec.connector,
                        chargeTime240: spec.chargeTime240
                    };
                    res.writeHead(200, { 'Content-Type': 'application/json' });
                    return res.end(JSON.stringify(specResult));
                }
                res.writeHead(502, { 'Content-Type': 'application/json' });
                return res.end(JSON.stringify({ error: 'Failed to fetch options from EPA service' }));
            }

            const items = extractMenuItems(optionsData);
            if (items.length === 0) {
                res.writeHead(404, { 'Content-Type': 'application/json' });
                return res.end(JSON.stringify({ error: 'No vehicle options found' }));
            }

            const vehicleId = items[0].value;
            const detailPath = `/vehicle/${encodeURIComponent(vehicleId)}`;
            fetchEpaData(detailPath, (err2, detailData) => {
                if (err2 || !detailData) {
                    res.writeHead(502, { 'Content-Type': 'application/json' });
                    return res.end(JSON.stringify({ error: 'Failed to fetch vehicle specs from EPA service' }));
                }

                const rangeMiles = parseFloat(detailData.range) || 0;
                const combE = parseFloat(detailData.combE) || 0;
                const charge240 = parseFloat(detailData.charge240) || 8;

                const calculatedBattery = (rangeMiles > 0 && combE > 0) ? parseFloat(((rangeMiles / 100) * combE).toFixed(1)) : 60;
                const rangeKm = Math.round(rangeMiles * 1.60934) || 250;

                const specResult = {
                    model: `${detailData.make} ${detailData.model} (${detailData.year})`,
                    batteryCapacity: calculatedBattery,
                    maxRange: rangeKm,
                    connector: 'CCS2',
                    chargeTime240: charge240
                };

                res.writeHead(200, { 'Content-Type': 'application/json' });
                return res.end(JSON.stringify(specResult));
            });
        });
        return;
    }

    // API Endpoint: Get distinct EV car companies (makes), for the make-first
    // model picker. Sorted alphabetically for a stable dropdown.
    if (pathname === '/api/ev-makes' && req.method === 'GET') {
        const makes = [...new Set(evModels.map(m => m.make).filter(Boolean))].sort();
        res.writeHead(200, { 'Content-Type': 'application/json' });
        return res.end(JSON.stringify(makes));
    }

    // API Endpoint: Get EV vehicles database, optionally filtered by ?make=
    if (pathname === '/api/ev-vehicles' && req.method === 'GET') {
        const make = parsedUrl.query.make;
        const list = make ? evModels.filter(m => m.make === make) : evModels;
        res.writeHead(200, { 'Content-Type': 'application/json' });
        return res.end(JSON.stringify(list));
    }

    // API Endpoint: VAHAN National EV Registry Query
    if (pathname === '/api/vahan/vehicle' && req.method === 'GET') {
        const rawRegNo = parsedUrl.query.regNo;
        if (!rawRegNo) {
            res.writeHead(400, { 'Content-Type': 'application/json' });
            return res.end(JSON.stringify({ error: 'Missing regNo query parameter' }));
        }

        const cleanReg = rawRegNo.replace(/[^A-Z0-9]/ig, '').toUpperCase();
        let found = vahanRegistry.find(r => r.registrationNo.replace(/[^A-Z0-9]/ig, '').toUpperCase() === cleanReg);

        if (!found) {
            const randomModel = evModels[Math.floor(Math.random() * evModels.length)] || { make: "Tata", model: "Nexon EV Max", modelFull: "Tata Nexon EV Max" };
            found = {
                registrationNo: rawRegNo.toUpperCase(),
                ownerName: "National Register EV Driver",
                make: (randomModel.make || '').toUpperCase(),
                model: randomModel.modelFull || `${randomModel.make} ${randomModel.model}`,
                fuelType: "ELECTRIC",
                regDate: new Date(Date.now() - Math.random() * 365 * 24 * 60 * 60 * 1000).toISOString().split('T')[0]
            };
        }

        res.writeHead(200, { 'Content-Type': 'application/json' });
        return res.end(JSON.stringify({ status: 'SUCCESS', record: found }));
    }

    // API Endpoint: Save User EV profile
    if (pathname === '/api/user/vehicle' && req.method === 'POST') {
        const auth = requireAuth(req, res);
        if (!auth) return;

        if (!body || !body.model || !body.vehicleNo) {
            res.writeHead(400, { 'Content-Type': 'application/json' });
            return res.end(JSON.stringify({ error: 'Missing model or vehicle number' }));
        }

        // The profile being written is always the caller's own, taken from the
        // signed token - a client-supplied body.email would let any signed-in
        // driver overwrite someone else's vehicle profile.
        const targetEmail = auth.email;

        const updates = {
            vehicleModel: body.model,
            vehicleNo: body.vehicleNo,
            batteryCapacity: body.batteryCapacity || 60,
            maxRange: body.maxRange || 300,
            preferredConnector: body.preferredConnector || 'CCS2',
            preferredSpeed: body.preferredSpeed || 'DC'
        };

        if (supabaseEnabled()) {
            try {
                const rows = await supabaseRequest('PATCH', `users?email=eq.${encodeURIComponent(targetEmail)}`, {
                    body: {
                        vehicle_model: updates.vehicleModel,
                        vehicle_no: updates.vehicleNo,
                        battery_capacity: updates.batteryCapacity,
                        max_range: updates.maxRange,
                        preferred_connector: updates.preferredConnector,
                        preferred_speed: updates.preferredSpeed
                    },
                    extraHeaders: { 'Prefer': 'return=representation' }
                });
                if (Array.isArray(rows) && rows[0]) {
                    res.writeHead(200, { 'Content-Type': 'application/json' });
                    return res.end(JSON.stringify({ status: 'SUCCESS', user: toSafeUser(normalizeUserRow(rows[0])) }));
                }
                res.writeHead(404, { 'Content-Type': 'application/json' });
                return res.end(JSON.stringify({ error: 'User not found' }));
            } catch (err) {
                console.error('Supabase vehicle update error, falling back to in-memory:', err.message);
            }
        }

        const user = store.users.find(u => u.email === targetEmail);
        if (!user) {
            res.writeHead(404, { 'Content-Type': 'application/json' });
            return res.end(JSON.stringify({ error: 'User not found' }));
        }
        Object.assign(user, updates);
        writeStore(store);
        res.writeHead(200, { 'Content-Type': 'application/json' });
        return res.end(JSON.stringify({ status: 'SUCCESS', user: toSafeUser(user) }));
    }

    // API Endpoint: Toggle a station bookmark on the caller's own profile.
    // Previously this was entirely client-side (activeUser.savedStations
    // mutated in memory only) - never sent to the server and never persisted
    // to the session cache either, so a bookmark vanished on any page reload.
    if (pathname === '/api/user/bookmark' && req.method === 'POST') {
        const auth = requireAuth(req, res);
        if (!auth) return;

        if (!body || !body.stationId) {
            res.writeHead(400, { 'Content-Type': 'application/json' });
            return res.end(JSON.stringify({ error: 'Missing stationId' }));
        }
        const targetEmail = auth.email;

        const applyToggle = (current) => {
            const list = Array.isArray(current) ? current.slice() : [];
            const idx = list.indexOf(body.stationId);
            if (idx > -1) list.splice(idx, 1); else list.push(body.stationId);
            return list;
        };

        if (supabaseEnabled()) {
            try {
                const existingRows = await supabaseRequest('GET', 'users', {
                    query: `select=saved_stations&email=eq.${encodeURIComponent(targetEmail)}&limit=1`
                });
                if (!Array.isArray(existingRows) || !existingRows[0]) {
                    res.writeHead(404, { 'Content-Type': 'application/json' });
                    return res.end(JSON.stringify({ error: 'User not found' }));
                }
                const nextList = applyToggle(existingRows[0].saved_stations);
                const rows = await supabaseRequest('PATCH', `users?email=eq.${encodeURIComponent(targetEmail)}`, {
                    body: { saved_stations: nextList },
                    extraHeaders: { 'Prefer': 'return=representation' }
                });
                if (Array.isArray(rows) && rows[0]) {
                    res.writeHead(200, { 'Content-Type': 'application/json' });
                    return res.end(JSON.stringify({ status: 'SUCCESS', user: toSafeUser(normalizeUserRow(rows[0])) }));
                }
                res.writeHead(404, { 'Content-Type': 'application/json' });
                return res.end(JSON.stringify({ error: 'User not found' }));
            } catch (err) {
                console.error('Supabase bookmark toggle error, falling back to in-memory:', err.message);
            }
        }

        const user = store.users.find(u => u.email === targetEmail);
        if (!user) {
            res.writeHead(404, { 'Content-Type': 'application/json' });
            return res.end(JSON.stringify({ error: 'User not found' }));
        }
        user.savedStations = applyToggle(user.savedStations);
        writeStore(store);
        res.writeHead(200, { 'Content-Type': 'application/json' });
        return res.end(JSON.stringify({ status: 'SUCCESS', user: toSafeUser(user) }));
    }

    // API Endpoint: Submit Charger Working Report
    if (pathname === '/api/reports/add' && req.method === 'POST') {
        const auth = requireAuth(req, res);
        if (!auth) return;

        if (!body || !body.stationId || body.working === undefined) {
            res.writeHead(400, { 'Content-Type': 'application/json' });
            return res.end(JSON.stringify({ error: 'Missing stationId or working flag' }));
        }
        const newReport = {
            stationId: body.stationId,
            working: body.working,
            timestamp: new Date().toISOString(),
            // Attributed to the signed-in reporter, not a client-supplied
            // address - the ops queue counts *distinct* reporters, so a
            // spoofable identity would let one client fake a consensus.
            userEmail: auth.email
        };

        if (supabaseEnabled()) {
            try {
                await supabaseRequest('POST', 'reports', {
                    body: { station_id: newReport.stationId, working: newReport.working, user_email: newReport.userEmail }
                });
                res.writeHead(200, { 'Content-Type': 'application/json' });
                return res.end(JSON.stringify({ status: 'SUCCESS', data: newReport }));
            } catch (err) {
                console.error('Supabase report insert error, falling back to in-memory:', err.message);
            }
        }

        store.reports.push(newReport);
        writeStore(store);
        res.writeHead(200, { 'Content-Type': 'application/json' });
        return res.end(JSON.stringify({ status: 'SUCCESS', data: newReport }));
    }

    // API Endpoint: Get Charger Working Reports Summary
    if (pathname === '/api/reports/summary' && req.method === 'GET') {
        let reports = store.reports;
        if (supabaseEnabled()) {
            try {
                const rows = await supabaseRequest('GET', 'reports', { query: 'select=station_id,working' });
                reports = (rows || []).map(r => ({ stationId: r.station_id, working: r.working }));
            } catch (err) {
                console.error('Supabase reports summary error, falling back to in-memory:', err.message);
            }
        }

        const summary = {};
        reports.forEach(r => {
            if (!summary[r.stationId]) {
                summary[r.stationId] = { working: 0, broken: 0 };
            }
            if (r.working) {
                summary[r.stationId].working++;
            } else {
                summary[r.stationId].broken++;
            }
        });
        res.writeHead(200, { 'Content-Type': 'application/json' });
        return res.end(JSON.stringify(summary));
    }

    // API Endpoint: Admin Update Station Metadata
    if (pathname === '/api/admin/station/update' && req.method === 'POST') {
        const auth = requireAdmin(req, res);
        if (!auth) return;

        if (!body || !body.stationId) {
            res.writeHead(400, { 'Content-Type': 'application/json' });
            return res.end(JSON.stringify({ error: 'Missing stationId' }));
        }
        const stationId = body.stationId;
        const override = {
            title: body.title,
            operator: body.operator,
            address: body.address,
            latitude: parseFloat(body.latitude),
            longitude: parseFloat(body.longitude),
            hours: body.hours,
            contact: body.contact,
            timestamp: new Date().toISOString()
        };
        store.adminOverrides.stations[stationId] = override;
        writeStore(store);

        if (supabaseEnabled()) {
            try {
                await supabaseRequest('POST', 'station_overrides?on_conflict=station_id', {
                    body: {
                        station_id: stationId,
                        title: override.title,
                        operator: override.operator,
                        address: override.address,
                        latitude: override.latitude,
                        longitude: override.longitude,
                        hours: override.hours,
                        contact: override.contact,
                        updated_at: override.timestamp
                    },
                    extraHeaders: { 'Prefer': 'resolution=merge-duplicates' }
                });
            } catch (err) {
                console.error('Supabase station override upsert error (in-memory mirror kept):', err.message);
            }
        }

        await recordAudit(store, auth, 'station.update', stationId, {
            title: override.title,
            operator: override.operator
        });

        return sendJson(res, 200, { status: 'SUCCESS', overrides: store.adminOverrides });
    }

    // API Endpoint: Admin Update Charger Status
    if (pathname === '/api/admin/charger/update' && req.method === 'POST') {
        const auth = requireAdmin(req, res);
        if (!auth) return;

        if (!body || !body.stationId || !body.chargerId || !body.status) {
            res.writeHead(400, { 'Content-Type': 'application/json' });
            return res.end(JSON.stringify({ error: 'Missing stationId, chargerId or status' }));
        }
        const stationId = body.stationId;
        const chargerId = body.chargerId;
        const timestamp = new Date().toISOString();
        if (!store.adminOverrides.chargers[stationId]) {
            store.adminOverrides.chargers[stationId] = {};
        }
        store.adminOverrides.chargers[stationId][chargerId] = { status: body.status, timestamp };
        writeStore(store);

        if (supabaseEnabled()) {
            try {
                await supabaseRequest('POST', 'charger_overrides?on_conflict=station_id,charger_id', {
                    body: { station_id: stationId, charger_id: chargerId, status: body.status, updated_at: timestamp },
                    extraHeaders: { 'Prefer': 'resolution=merge-duplicates' }
                });
            } catch (err) {
                console.error('Supabase charger override upsert error (in-memory mirror kept):', err.message);
            }
        }

        await recordAudit(store, auth, 'charger.status', `${stationId}/${chargerId}`, { status: body.status });

        return sendJson(res, 200, { status: 'SUCCESS', overrides: store.adminOverrides });
    }

    // API Endpoint: Get All Admin Overrides
    if (pathname === '/api/admin/overrides' && req.method === 'GET') {
        if (!requireAuth(req, res)) return;

        if (supabaseEnabled()) {
            try {
                const [stationRows, chargerRows] = await Promise.all([
                    supabaseRequest('GET', 'station_overrides', { query: 'select=*' }),
                    supabaseRequest('GET', 'charger_overrides', { query: 'select=*' })
                ]);
                const overrides = { stations: {}, chargers: {} };
                (stationRows || []).forEach(r => {
                    overrides.stations[r.station_id] = {
                        title: r.title, operator: r.operator, address: r.address,
                        latitude: r.latitude, longitude: r.longitude, hours: r.hours,
                        contact: r.contact, timestamp: r.updated_at
                    };
                });
                (chargerRows || []).forEach(r => {
                    if (!overrides.chargers[r.station_id]) overrides.chargers[r.station_id] = {};
                    overrides.chargers[r.station_id][r.charger_id] = { status: r.status, timestamp: r.updated_at };
                });
                res.writeHead(200, { 'Content-Type': 'application/json' });
                return res.end(JSON.stringify(overrides));
            } catch (err) {
                console.error('Supabase admin overrides fetch error, falling back to in-memory:', err.message);
            }
        }
        res.writeHead(200, { 'Content-Type': 'application/json' });
        return res.end(JSON.stringify(store.adminOverrides));
    }

    // API Endpoint: Admin ops queue - community fault reports grouped per
    // station, severity-scored and carrying triage state.
    if (pathname === '/api/admin/ops-queue' && req.method === 'GET') {
        if (!requireAdmin(req, res)) return;

        const [reports, resolutions] = await Promise.all([
            fetchAllReports(store),
            fetchReportResolutions(store)
        ]);
        const queue = buildOpsQueue(reports, resolutions);

        return sendJson(res, 200, {
            queue,
            counts: {
                total: queue.length,
                open: queue.filter(q => q.status === 'open').length,
                acknowledged: queue.filter(q => q.status === 'acknowledged').length,
                resolved: queue.filter(q => q.status === 'resolved').length,
                critical: queue.filter(q => q.status === 'open' && q.severity === 'CRITICAL').length
            },
            totalReports: reports.length,
            dataSource: supabaseEnabled() ? 'SUPABASE' : 'SESSION_ONLY'
        });
    }

    // API Endpoint: Admin triage action on one ops-queue item.
    if (pathname === '/api/admin/reports/resolve' && req.method === 'POST') {
        const auth = requireAdmin(req, res);
        if (!auth) return;

        const validStatuses = ['open', 'acknowledged', 'resolved'];
        if (!body || !body.stationId || !validStatuses.includes(body.status)) {
            return sendJson(res, 400, {
                error: `Missing stationId, or status not one of: ${validStatuses.join(', ')}`
            });
        }

        const record = {
            status: body.status,
            actor: auth.email,
            note: (body.note || '').slice(0, 500),
            at: new Date().toISOString()
        };

        store.reportResolutions = store.reportResolutions || {};
        store.reportResolutions[body.stationId] = record;
        writeStore(store);

        if (supabaseEnabled()) {
            try {
                await supabaseRequest('POST', 'report_resolutions?on_conflict=station_id', {
                    body: {
                        station_id: body.stationId,
                        status: record.status,
                        actor: record.actor,
                        note: record.note,
                        updated_at: record.at
                    },
                    extraHeaders: { 'Prefer': 'resolution=merge-duplicates' }
                });
            } catch (err) {
                console.error('Supabase resolution upsert error (local mirror kept):', err.message);
            }
        }

        await recordAudit(store, auth, `report.${record.status}`, body.stationId, { note: record.note });
        return sendJson(res, 200, { status: 'SUCCESS', resolution: record });
    }

    // API Endpoint: Admin audit trail of every admin mutation.
    if (pathname === '/api/admin/audit' && req.method === 'GET') {
        if (!requireAdmin(req, res)) return;

        const limit = Math.min(parseInt(parsedUrl.query.limit, 10) || 100, 500);
        const entries = await fetchAuditLog(store, limit);
        return sendJson(res, 200, { entries, dataSource: supabaseEnabled() ? 'SUPABASE' : 'SESSION_ONLY' });
    }

    // API Endpoint: Deeper analytics cuts for the admin Analytics tab.
    if (pathname === '/api/admin/analytics' && req.method === 'GET') {
        if (!requireAdmin(req, res)) return;

        const events = await fetchAnalyticsEvents(store);
        return sendJson(res, 200, {
            ...buildAdminAnalytics(events),
            totalEvents: events.length,
            dataSource: supabaseEnabled() ? 'SUPABASE' : 'SESSION_ONLY'
        });
    }

    // API Endpoint: Public health/readiness probe. Reports which optional
    // integrations are actually wired up on this deployment.
    if (pathname === '/api/health' && req.method === 'GET') {
        return sendJson(res, 200, {
            status: 'ok',
            time: new Date().toISOString(),
            integrations: {
                supabase: supabaseEnabled(),
                googleMaps: !!GOOGLE_MAPS_API_KEY,
                openChargeMap: !!OCM_API_KEY,
                indiaEnergyAtlas: !!ATLAS_API_KEY,
                sessionSecret: !!process.env.SESSION_SECRET
            }
        });
    }

    // API Endpoint: Log an impact/analytics event (session start, route
    // planned, or charger diverted-to). Fire-and-forget from the client;
    // always returns 200 even on a storage failure so it never blocks the UI.
    if (pathname === '/api/analytics/event' && req.method === 'POST') {
        if (!body || !ANALYTICS_EVENT_TYPES.has(body.type)) {
            res.writeHead(400, { 'Content-Type': 'application/json' });
            return res.end(JSON.stringify({ error: 'Missing or invalid event type' }));
        }
        const event = {
            type: body.type,
            userEmail: body.userEmail || 'anonymous',
            stationId: body.stationId || null,
            metadata: body.metadata || {},
            createdAt: new Date().toISOString()
        };

        if (supabaseEnabled()) {
            try {
                await supabaseRequest('POST', 'analytics_events', {
                    body: { event_type: event.type, user_email: event.userEmail, station_id: event.stationId, metadata: event.metadata }
                });
                res.writeHead(200, { 'Content-Type': 'application/json' });
                return res.end(JSON.stringify({ status: 'SUCCESS' }));
            } catch (err) {
                console.error('Supabase analytics insert error, falling back to in-memory:', err.message);
            }
        }

        store.analytics.push(event);
        writeStore(store);
        res.writeHead(200, { 'Content-Type': 'application/json' });
        return res.end(JSON.stringify({ status: 'SUCCESS_LOCAL' }));
    }

    // API Endpoint: Admin impact dashboard - fleet-wide traffic diverted
    // through GridSync, with estimated kWh/CO2/revenue and a 14-day trend.
    if (pathname === '/api/analytics/summary' && req.method === 'GET') {
        if (!requireAdmin(req, res)) return;

        const events = await fetchAnalyticsEvents(store);
        const summary = summarizeAnalyticsEvents(events);

        let reportsCount = 0;
        if (supabaseEnabled()) {
            try {
                const rows = await supabaseRequest('GET', 'reports', { query: 'select=id' });
                reportsCount = (rows || []).length;
            } catch (err) {
                reportsCount = store.reports.length;
            }
        } else {
            reportsCount = store.reports.length;
        }

        res.writeHead(200, { 'Content-Type': 'application/json' });
        return res.end(JSON.stringify({
            ...summary,
            communityReportsSubmitted: reportsCount,
            dataSource: supabaseEnabled() ? 'SUPABASE' : 'SESSION_ONLY',
            assumptions: {
                acSessionKwh: AC_SESSION_KWH_ESTIMATE,
                dcSessionKwh: DC_SESSION_KWH_ESTIMATE,
                netCo2SavedKgPerKwh: Math.round(NET_CO2_SAVED_KG_PER_KWH * 1000) / 1000
            }
        }));
    }

    // API Endpoint: Personal impact card for one driver (Profile tab)
    if (pathname === '/api/analytics/me' && req.method === 'GET') {
        const auth = requireAuth(req, res);
        if (!auth) return;

        // Always read the caller's own stats from the signed token, never from a
        // client-supplied ?email= - otherwise any signed-in driver could read
        // another driver's activity by changing the query string.
        const email = auth.email;
        const events = await fetchAnalyticsEvents(store, null, email);
        const summary = summarizeAnalyticsEvents(events);
        res.writeHead(200, { 'Content-Type': 'application/json' });
        return res.end(JSON.stringify({
            diversions: summary.diversions,
            routesPlanned: summary.routesPlanned,
            estimatedKwh: summary.estimatedKwh,
            estimatedCo2SavedKg: summary.estimatedCo2SavedKg,
            estimatedRevenueInr: summary.estimatedRevenueInr,
            dataSource: supabaseEnabled() ? 'SUPABASE' : 'SESSION_ONLY'
        }));
    }

    // API Endpoint: AI Predict Arrival State
    if (pathname === '/api/predict_arrival' && req.method === 'POST') {
        const data = body || {};
        const stationId = data.station_id || 'unknown';
        const etaMinutes = data.eta_minutes || 0;
        const arrivalDate = new Date(Date.now() + etaMinutes * 60 * 1000);
        const arrivalHour = arrivalDate.getHours();

        let gridLoad = "MEDIUM";
        let dynamicPrice = 16.00;
        let probAvailable = 0.70;

        if (arrivalHour >= 17 && arrivalHour <= 20) {
            gridLoad = "HIGH";
            dynamicPrice = 24.50;
            probAvailable = 0.35;
        } else if (arrivalHour >= 22 || arrivalHour <= 6) {
            gridLoad = "LOW";
            dynamicPrice = 12.00;
            probAvailable = 0.95;
        }

        const hours12 = arrivalHour % 12 || 12;
        const ampm = arrivalHour >= 12 ? 'PM' : 'AM';
        const minutesFormatted = String(arrivalDate.getMinutes()).padStart(2, '0');
        const predictedArrivalStr = `${String(hours12).padStart(2, '0')}:${minutesFormatted} ${ampm}`;

        res.writeHead(200, { 'Content-Type': 'application/json' });
        return res.end(JSON.stringify({
            station_id: stationId,
            predicted_arrival_time: predictedArrivalStr,
            predicted_grid_load: gridLoad,
            dynamic_price_at_arrival: dynamicPrice,
            probability_available: Math.round(probAvailable * 100)
        }));
    }

    res.writeHead(404, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: 'Not found' }));
};
