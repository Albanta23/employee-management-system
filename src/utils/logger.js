const crypto = require('crypto');

function nowIso() {
    return new Date().toISOString();
}

function safeString(v) {
    if (v === null || v === undefined) return undefined;
    const s = String(v);
    return s.length > 500 ? s.slice(0, 500) + '…' : s;
}

function generateRequestId() {
    if (crypto.randomUUID) return crypto.randomUUID();
    return crypto.randomBytes(16).toString('hex');
}

function baseLog(level, message, meta) {
    const payload = {
        ts: nowIso(),
        level,
        msg: safeString(message),
        ...meta
    };

    // Evitar undefined en JSON
    Object.keys(payload).forEach((k) => payload[k] === undefined && delete payload[k]);

    const line = JSON.stringify(payload);
    if (level === 'error') console.error(line);
    else if (level === 'warn') console.warn(line);
    else console.log(line);
}

const logger = {
    generateRequestId,
    info: (msg, meta = {}) => baseLog('info', msg, meta),
    warn: (msg, meta = {}) => baseLog('warn', msg, meta),
    error: (msg, meta = {}) => baseLog('error', msg, meta)
};

module.exports = logger;
