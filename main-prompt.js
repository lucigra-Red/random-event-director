// Capture text only, without request parameters, credentials, images or tool schemas.
export function mainPromptText(payload, state, limit = state.contextChars, cycleKey = null) {
    const source = payload?.messages ?? payload?.prompt;
    const owned = [...new Set([state.cycles[cycleKey]?.injection, state.pendingEvent?.injection,
        ...Object.values(state.cycles).slice(-40).map(c => c.injection)].filter(Boolean))];
    let scanned = 0;
    const clean = value => {
        if (typeof value !== 'string' || scanned >= 2000000) return '';
        let text = value.slice(0, 2000000 - scanned); scanned += text.length;
        for (const injection of owned) text = text.replaceAll(injection, '');
        return text.trim();
    };
    let text;
    if (typeof source === 'string') text = clean(source);
    else if (Array.isArray(source)) text = source.slice(0, 2000).map(row => {
        const body = typeof row?.content === 'string' ? clean(row.content)
            : Array.isArray(row?.content) ? row.content.slice(0, 100).filter(part => part?.type === 'text').map(part => clean(part.text)).filter(Boolean).join('\n') : '';
        const role = ['system', 'user', 'assistant', 'tool', 'function'].includes(row?.role) ? row.role : 'context';
        return body ? `[${role}]\n${body}` : '';
    }).filter(Boolean).join('\n\n');
    else return '';
    if (text.length <= limit) return text;
    // Preserve both initial world/system information and the most recent conversation.
    const marker = '\n[中间部分因字数上限省略]\n';
    const head = Math.floor((limit - marker.length) / 2);
    return text.slice(0, head) + marker + text.slice(-(limit - marker.length - head));
}
