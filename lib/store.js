const fs = require('fs');
const os = require('os');
const path = require('path');

// File-backed fallback store, used only when SUPABASE_URL/SUPABASE_KEY are not
// configured. A plain `global.*` object does NOT reliably survive between
// requests under Vercel's local dev server (each invocation can run in its
// own isolate, so in-memory state written by one request is invisible to the
// next) - writes silently succeeded while every subsequent read came back
// empty. os.tmpdir() is used instead of a path under the project directory
// because it is the one location guaranteed writable both in local dev and
// on an actual Vercel Lambda (whose deployment filesystem is read-only).
//
// This does NOT make the fallback durable in real serverless production -
// /tmp is still wiped on cold start there, exactly as the comments elsewhere
// in api/handler.js already document. It only fixes the fallback so it
// behaves consistently within one running dev server / one warm instance,
// instead of silently no-op'ing on every read. Configure SUPABASE_URL/
// SUPABASE_KEY (see supabase/schema.sql) for real persistence.
const STORE_PATH = path.join(os.tmpdir(), 'gridsync-fallback-store.json');

function defaultStore() {
    return {
        users: null, // populated by the caller with seeded demo accounts on first read
        savedTrips: [],
        reports: [],
        adminOverrides: { stations: {}, chargers: {} },
        analytics: []
    };
}

function readStore() {
    try {
        const raw = fs.readFileSync(STORE_PATH, 'utf8');
        const parsed = JSON.parse(raw);
        return { ...defaultStore(), ...parsed };
    } catch (e) {
        return defaultStore();
    }
}

function writeStore(store) {
    try {
        fs.writeFileSync(STORE_PATH, JSON.stringify(store));
    } catch (e) {
        console.error('Failed to persist fallback store (in-memory only for this request):', e.message);
    }
}

module.exports = { readStore, writeStore };
