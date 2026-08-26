// One-time seed: inserts (or updates) the two demo accounts into the Supabase
// `users` table with properly hashed passwords, so login works against the
// real DB the same way it does against the in-memory fallback.
//
// Usage:
//   node scripts/seed-supabase.js
//
// Reads SUPABASE_URL / SUPABASE_KEY from the environment, falling back to a
// manual parse of .env.local (no dotenv dependency, matching this project's
// zero-dependency convention).

const fs = require('fs');
const path = require('path');
const https = require('https');
const url = require('url');
const { hashPassword } = require('../lib/auth');

function loadDotEnvLocal() {
    const envPath = path.join(__dirname, '..', '.env.local');
    if (!fs.existsSync(envPath)) return;
    const lines = fs.readFileSync(envPath, 'utf8').split('\n');
    for (const line of lines) {
        const trimmed = line.trim();
        if (!trimmed || trimmed.startsWith('#')) continue;
        const eq = trimmed.indexOf('=');
        if (eq === -1) continue;
        const key = trimmed.slice(0, eq).trim();
        let value = trimmed.slice(eq + 1).trim();
        if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
            value = value.slice(1, -1);
        }
        if (!(key in process.env)) process.env[key] = value;
    }
}

loadDotEnvLocal();

const SUPABASE_URL = process.env.SUPABASE_URL || '';
const SUPABASE_KEY = process.env.SUPABASE_KEY || '';

if (!SUPABASE_URL || !SUPABASE_KEY) {
    console.error('SUPABASE_URL and SUPABASE_KEY must be set (in the environment or .env.local) before seeding.');
    process.exit(1);
}

const seedUsers = [
    {
        email: 'user@gridsync.in',
        password_hash: hashPassword('user123'),
        role: 'User',
        name: 'GridSync Driver',
        phone: '+91 98765 43210',
        vehicle_model: 'Tata Nexon EV Max',
        battery_capacity: 40.5,
        max_range: 437,
        preferred_connector: 'CCS2',
        min_reserve: 15,
        preferred_speed: 'DC',
        saved_stations: [],
        charging_history: [
            { date: '2026-08-20', station: 'Zeon Charging - Lonavala', energy: '28.4 kWh', cost: '₹383.40', type: 'DC Fast' },
            { date: '2026-08-15', station: 'Tata Power EZ Charge - Expressway', energy: '15.2 kWh', cost: '₹174.80', type: 'AC Charger' }
        ]
    },
    {
        email: 'admin@gridsync.in',
        password_hash: hashPassword('admin123'),
        role: 'Admin',
        name: 'GridSync Operator',
        phone: '+91 99999 88888'
    }
];

function upsertUsers(rows) {
    return new Promise((resolve, reject) => {
        const targetUrl = `${SUPABASE_URL}/rest/v1/users?on_conflict=email`;
        const parsed = url.parse(targetUrl);
        const postData = JSON.stringify(rows);
        const req = https.request({
            hostname: parsed.hostname,
            path: parsed.path,
            port: parsed.port || 443,
            method: 'POST',
            headers: {
                'apikey': SUPABASE_KEY,
                'Authorization': `Bearer ${SUPABASE_KEY}`,
                'Content-Type': 'application/json',
                'Content-Length': Buffer.byteLength(postData),
                'Prefer': 'resolution=merge-duplicates,return=representation'
            }
        }, (res) => {
            let responseBody = '';
            res.on('data', chunk => { responseBody += chunk; });
            res.on('end', () => {
                if (res.statusCode >= 200 && res.statusCode < 300) {
                    resolve(responseBody);
                } else {
                    reject(new Error(`Seed failed: ${res.statusCode} ${responseBody}`));
                }
            });
        });
        req.on('error', reject);
        req.write(postData);
        req.end();
    });
}

upsertUsers(seedUsers)
    .then((result) => {
        console.log('Seeded demo users into Supabase:');
        console.log(result);
    })
    .catch((err) => {
        console.error(err.message);
        process.exit(1);
    });
