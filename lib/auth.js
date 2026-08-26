const crypto = require('crypto');

// scrypt password hashing. No dependency beyond Node's built-in crypto module,
// consistent with this project's zero-dependency convention.
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

module.exports = { hashPassword, verifyPassword };
