const TYPES = new Set(['normal', 'regenerate', 'swipe', 'continue', 'append', 'quiet', 'impersonate', 'first_message']);
const secondaryPayloads = new WeakSet();
export function markSecondaryPayload(payload) { secondaryPayloads.add(payload); }
export function isSecondaryPayload(payload) { return secondaryPayloads.has(payload); }
export function requestGenerationType(payload) {
    if (!payload || typeof payload !== 'object' || !Object.hasOwn(payload, 'type')) return null;
    // Native Chat Completion includes an undefined type for Generate()'s ordinary reply.
    if (payload.type === undefined) return 'normal';
    return TYPES.has(payload.type) ? payload.type : null;
}
export function eventGenerationType(args) {
    for (const value of args) {
        if (typeof value === 'string' && TYPES.has(value)) return value;
        if (value && typeof value === 'object' && TYPES.has(value.type)) return value.type;
    }
    return undefined;
}

// Remove only our frozen, exact injection. Never clear another extension's prompt or rewrite the pool.
export function stripOwnedInjection(payload, injection) {
    if (!injection || !payload || typeof payload !== 'object') return false;
    let changed = false;
    const strip = text => {
        if (typeof text !== 'string' || !text.includes(injection)) return text;
        changed = true; return text.split(injection).join('');
    };
    for (const key of ['messages', 'prompt']) {
        if (typeof payload[key] === 'string') { const next = strip(payload[key]); if (next !== payload[key]) payload[key] = next; }
        else if (Array.isArray(payload[key])) {
            const before = changed;
            // Extensions can share arrays with a main request. Detach before changing this request only.
            const rows = payload[key].map(row => row && typeof row === 'object' ? { ...row,
                ...(Array.isArray(row.content) ? { content: row.content.map(part => part && typeof part === 'object' ? { ...part } : part) } : {}) } : row);
            let rowChanged = false;
            for (let i = rows.length - 1; i >= 0; i--) {
                const row = rows[i];
                if (!row || typeof row !== 'object') continue;
                if (typeof row.content === 'string') {
                    const before = row.content; row.content = strip(before);
                    if (before !== row.content) { rowChanged = true; if (!row.content.trim()) rows.splice(i, 1); }
                } else if (Array.isArray(row.content)) {
                    let removed = false;
                    for (let j = row.content.length - 1; j >= 0; j--) {
                        const part = row.content[j];
                        if (part?.type !== 'text' || typeof part.text !== 'string') continue;
                        const before = part.text; part.text = strip(before);
                        if (before !== part.text) { rowChanged = true; if (!part.text.trim()) { row.content.splice(j, 1); removed = true; } }
                    }
                    if (removed && !row.content.length) rows.splice(i, 1);
                }
            }
            if (rowChanged || changed !== before) payload[key] = rows;
        }
    }
    return changed;
}
