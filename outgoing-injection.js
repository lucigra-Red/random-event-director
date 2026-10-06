const MAX_CHARS = 2000000;
const normalize = text => text.replace(/\s+/g, ' ').trim();
// Some presets end with a user-role assistant prefill. Keep its absolute tail intact.
const cueTail = text => /(?:<\|[^|<>\r\n]{1,32}\|>|<[A-Za-z_][\w-]{0,31}>|(?:^|\n)[^\s:：]{1,32}:)\s*$/.test(text);

function texts(row) {
    if (typeof row?.content === 'string') return [row.content];
    if (Array.isArray(row?.content)) return row.content.filter(p => p?.type === 'text' && typeof p.text === 'string').map(p => p.text);
    return [];
}

// A pure, transactional transform. Match only our frozen full instruction, never another
// extension's key, event title, generic tags or the Story Oracle guidance/protocol text.
export function placeEventInMessages(messages, injection, { allowUser = true } = {}) {
    const unchanged = reason => ({ messages: null, changed: false, reason });
    if (!Array.isArray(messages) || messages.length > 2000 || typeof injection !== 'string' || !injection.trim()) return unchanged('unsupported');
    let characters = 0, count = 0, unsafe = false;
    const allText = [];
    for (const row of messages) {
        if (Array.isArray(row?.content) && row.content.length > 100) return unchanged('too-large');
        for (const text of texts(row)) {
            characters += text.length;
            if (characters > MAX_CHARS) return unchanged('too-large');
            allText.push(text);
            let from = 0, at;
            while ((at = text.indexOf(injection, from)) >= 0) {
                count++;
                const end = at + injection.length;
                if ((at > 0 && text[at - 1] !== '\n' && text.slice(0, at).trim())
                    || (end < text.length && text[end] !== '\n' && text[end] !== '\r' && text.slice(end).trim())) unsafe = true;
                from = end;
            }
        }
    }
    // Whitespace changes and embedded quotations are not grounds to remove someone else's text.
    if (unsafe) return unchanged('not-owned-block');
    if (!count && normalize(allText.join('\n')).includes(normalize(injection))) return unchanged('reformatted');
    const remove = (text, userPrefix = false) => {
        // Remove the separator we added at the player-message head as a unit.
        // Leave any whitespace belonging to the original player message intact.
        if (userPrefix && text.startsWith(`${injection}\n\n`)) text = text.slice(injection.length + 2);
        let at;
        while ((at = text.indexOf(injection)) >= 0) {
            let start = at, end = at + injection.length;
            if (text[end] === '\r' && text[end + 1] === '\n') end += 2;
            else if (text[end] === '\n') end++;
            else if (start > 0 && text[start - 1] === '\n') { start--; if (text[start - 1] === '\r') start--; }
            text = text.slice(0, start) + text.slice(end);
        }
        return text;
    };
    const out = [];
    for (const original of messages) {
        let row = original, removed = false;
        if (typeof row?.content === 'string' && row.content.includes(injection)) {
            row = { ...row, content: remove(row.content, row.role === 'user') }; removed = true;
        } else if (Array.isArray(row?.content) && texts(row).some(t => t.includes(injection))) {
            row = { ...row, content: row.content.flatMap(part => {
                if (part?.type !== 'text' || typeof part.text !== 'string' || !part.text.includes(injection)) return [part];
                const text = remove(part.text); return text.trim() ? [{ ...part, text }] : [];
            }) }; removed = true;
        }
        if (removed && row.role === 'system' && !row.name && (!row.content.length || (typeof row.content === 'string' && !row.content.trim()))) continue;
        out.push(row);
    }
    let user = -1;
    if (allowUser) for (let i = out.length - 1; i >= 0; i--) {
        const row = out[i];
        if (row?.role !== 'user' || row.name?.startsWith('example_')) continue;
        if (typeof row.content !== 'string' && !Array.isArray(row.content)) continue;
        if (cueTail(texts(row).join('\n'))) continue;
        user = i; break;
    }
    if (user < 0) {
        // Continue/prefill or an unsupported player message: preserve an existing injection.
        if (count === 1) return unchanged('no-user');
        out.unshift({ role: 'system', content: injection });
    } else {
        const row = out[user];
        out[user] = { ...row, content: typeof row.content === 'string' ? `${injection}\n\n${row.content}`
            : [{ type: 'text', text: injection }, ...row.content] };
    }
    // Verify exactly one full copy before replacing the outgoing request. No writes to chat history.
    const occurrences = out.flatMap(texts).reduce((sum, text) => sum + text.split(injection).length - 1, 0);
    if (occurrences !== 1) return unchanged('selfcheck');
    return { messages: out, changed: true, reason: user < 0 ? 'system-repaired' : (count ? 'moved' : 'repaired'), count };
}
