const crypto = require('crypto');

// scrypt password hashing + HMAC-signed stateless session tokens. No dependency
// beyond Node's built-in crypto module, consistent with this project's
// zero-dependency convention.
const KEY_LENGTH = 64;

function hashPassword(password) {
    const salt = crypto.randomBytes(16).toString('hex');
    const hash = crypto.scryptSync(password, salt, KEY_LENGTH).toString('hex');
    return `scrypt:${salt}:${hash}`;
}

function verifyPassword(password, stored) {
    if (!stored || typeof stored !== 'string' || !stored.startsWith('scrypt:')) return false;
    const [, salt, hash] = stored.split(':');
    if (!salt || !hash) return false;
    const hashBuffer = Buffer.from(hash, 'hex');
    const candidate = crypto.scryptSync(password, salt, KEY_LENGTH);
    if (candidate.length !== hashBuffer.length) return false;
    return crypto.timingSafeEqual(candidate, hashBuffer);
}

// ---------------------------------------------------------------------------
// Session tokens.
//
// Compact JWT-shaped `<payload>.<signature>` tokens, both base64url. Stateless
// and HMAC-SHA256 signed, so a serverless instance can validate a token without
// any shared session store - which matters here because there isn't one (see
// lib/store.js on why in-memory state can't be relied on across requests).
//
// SESSION_SECRET must be set in production. When it isn't, we derive a random
// per-process secret so the app still runs locally - but every cold start then
// invalidates existing tokens, so `requireAuth` callers just see expired
// sessions rather than a silently-forgeable one. Never fall back to a constant.
const SESSION_TTL_SECONDS = 60 * 60 * 12; // 12 hours

let cachedSecret = null;
function getSecret() {
    if (cachedSecret) return cachedSecret;
    const envSecret = process.env.SESSION_SECRET;
    if (envSecret && envSecret.length >= 16) {
        cachedSecret = envSecret;
    } else {
        if (process.env.NODE_ENV === 'production') {
            console.warn('SESSION_SECRET is not set - sessions will not survive a cold start.');
        }
        cachedSecret = crypto.randomBytes(32).toString('hex');
    }
    return cachedSecret;
}

const b64url = (buf) => Buffer.from(buf).toString('base64')
    .replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
const b64urlDecode = (str) => Buffer.from(
    str.replace(/-/g, '+').replace(/_/g, '/'), 'base64'
).toString('utf8');

function signToken(payload, ttlSeconds = SESSION_TTL_SECONDS) {
    const body = {
        ...payload,
        iat: Math.floor(Date.now() / 1000),
        exp: Math.floor(Date.now() / 1000) + ttlSeconds
    };
    const encoded = b64url(JSON.stringify(body));
    const signature = crypto.createHmac('sha256', getSecret()).update(encoded).digest();
    return `${encoded}.${b64url(signature)}`;
}

function verifyToken(token) {
    if (!token || typeof token !== 'string') return null;
    const parts = token.split('.');
    if (parts.length !== 2) return null;
    const [encoded, signature] = parts;

    const expected = b64url(
        crypto.createHmac('sha256', getSecret()).update(encoded).digest()
    );
    // Constant-time compare; length check first because timingSafeEqual throws
    // on mismatched buffer lengths.
    const sigBuf = Buffer.from(signature);
    const expBuf = Buffer.from(expected);
    if (sigBuf.length !== expBuf.length) return null;
    if (!crypto.timingSafeEqual(sigBuf, expBuf)) return null;

    let payload;
    try {
        payload = JSON.parse(b64urlDecode(encoded));
    } catch (e) {
        return null;
    }
    if (!payload.exp || payload.exp < Math.floor(Date.now() / 1000)) return null;
    return payload;
}

// Pull a bearer token off an incoming request and return its payload, or null.
function getAuthContext(req) {
    const header = (req.headers && (req.headers.authorization || req.headers.Authorization)) || '';
    const match = /^Bearer\s+(.+)$/i.exec(header.trim());
    if (!match) return null;
    return verifyToken(match[1]);
}

module.exports = {
    hashPassword,
    verifyPassword,
    signToken,
    verifyToken,
    getAuthContext,
    SESSION_TTL_SECONDS
};
